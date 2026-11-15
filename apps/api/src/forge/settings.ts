import type { Prisma } from '@prisma/client';
import { ForgeSettings, type ForgeSettings as ForgeSettingsT } from '@praxis/shared';
import type { Config } from '../config';
import type { Db, Tx } from '../db';

/** MVP1 per-client settings (docs/design/PROJECT-SCREEN-DESIGN.md): the earlier journey stays until newFlow is on. */
export const FORGE_DEFAULTS: ForgeSettingsT = { newFlow: false, candidateSignIn: 'OFFLINE' };

/** The forge settings inside a Client.settings value, with defaults for anything missing or malformed. */
export function forgeFrom(settings: unknown): ForgeSettingsT {
  const raw = (settings && typeof settings === 'object' ? (settings as { forge?: unknown }).forge : undefined) ?? {};
  const parsed = ForgeSettings.partial().safeParse(raw);
  return { ...FORGE_DEFAULTS, ...(parsed.success ? parsed.data : {}) };
}

/** The client's forge settings (defaults when none are stored). */
export async function forgeSettings(db: Db | Tx, clientId: string): Promise<ForgeSettingsT> {
  const c = await db.client.findUnique({ where: { id: clientId }, select: { settings: true } });
  return forgeFrom(c?.settings);
}

/**
 * Offline candidate sign-in (email and name, no password) is unauthenticated, so it is refused in production
 * (APP_ENV=production, or a production build with no APP_ENV), whatever the switch says. Staging and demo (QA) allow it.
 */
export function offlineSignInAllowed(config: Pick<Config, 'NODE_ENV' | 'appEnv'>): boolean {
  return config.appEnv !== 'production' && !(config.NODE_ENV === 'production' && config.appEnv === 'local');
}

/** Merges `forge` into Client.settings, keeping every other key. The caller locks the client row. */
export function withForge(settings: unknown, forge: ForgeSettingsT): Prisma.InputJsonValue {
  const base = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
  return { ...base, forge } as Prisma.InputJsonValue;
}
