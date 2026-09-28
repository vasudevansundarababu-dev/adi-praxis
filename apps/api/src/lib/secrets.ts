import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Config } from '../config';

/**
 * Encryption for the few secrets M10 must read back (partner webhook signing secrets, generated test answer keys).
 * AES-256-GCM with M10_ENCRYPTION_KEY. Outside production a key derived from MOCK_SECRET is used when none is set, so
 * local development and tests need no setup; production refuses to start without a real key (config.ts).
 */
export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

export function secretBox(config: Pick<Config, 'M10_ENCRYPTION_KEY' | 'MOCK_SECRET'>): SecretBox {
  const given = Buffer.from(config.M10_ENCRYPTION_KEY, 'base64');
  const key = given.length === 32 ? given : createHash('sha256').update(`m10-dev-key:${config.MOCK_SECRET}`).digest();
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
    },
    decrypt(sealed) {
      const [v, iv, tag, data] = sealed.split('.');
      if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised sealed value');
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
    },
  };
}
