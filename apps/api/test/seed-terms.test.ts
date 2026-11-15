import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TERMS_KEYS } from '@praxis/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APPROVED_TERMS_DIR, readApprovedTerms, seed } from '../prisma/seed';
import { currentTerms, seedPlaceholderTerms, seedTerms } from '../src/candidate/onboarding-service';
import { sha256 } from '../src/lib/crypto';
import { db, resetDb } from './helpers';

/**
 * Owner, 15 Nov 2026: the three approved terms published in QA are seed data, so every fresh database starts with
 * them instead of placeholders. Create-only: an Admin's later version is never overwritten.
 */
const ENV = { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' };

describe('approved terms as seed data', () => {
  beforeEach(resetDb);
  afterAll(() => db.$disconnect());

  it('the repo holds approved text (not placeholder) for all three documents', () => {
    const approved = readApprovedTerms();
    expect(Object.keys(approved).sort()).toEqual([...TERMS_KEYS].sort());
    for (const key of TERMS_KEYS) {
      expect(approved[key]!.title.trim()).not.toBe('');
      expect(approved[key]!.body.length).toBeGreaterThan(200);
      expect(approved[key]!.body).not.toMatch(/^PLACEHOLDER/);
    }
    expect(APPROVED_TERMS_DIR).toMatch(/prisma[\\/]seed-data[\\/]terms$/);
  });

  it('a fresh database gets version 1 of each approved document, and running the seed again changes nothing', async () => {
    const { client } = await seed(db, ENV);
    const approved = readApprovedTerms();
    const docs = await currentTerms(db, client.id);
    for (const [i, key] of TERMS_KEYS.entries()) {
      expect(docs[i]).toMatchObject({ key, version: 1, placeholder: false, title: approved[key]!.title, body: approved[key]!.body, sha256: sha256(approved[key]!.body) });
    }
    await seed(db, ENV);
    expect(await db.termsDocument.count({ where: { clientId: client.id } })).toBe(3);
  });

  it('placeholders get the approved text as the next version; an Admin-published version is left alone', async () => {
    const { client, admin } = await seed(db, { ...ENV, SEED_TERMS_DIR: 'none' });
    expect((await currentTerms(db, client.id)).every((d) => d!.placeholder)).toBe(true);
    // An Admin publishes their own data-use text over the placeholder before the approved seed runs.
    await db.termsDocument.create({ data: { clientId: client.id, key: 'data_use', version: 2, title: 'Admin text', body: 'Admin-published data use text.', sha256: sha256('Admin-published data use text.'), publishedById: admin.id } });
    await seedTerms(db, client.id, admin.id, readApprovedTerms());
    const [contributor, confidentiality, dataUse] = await currentTerms(db, client.id);
    expect(contributor).toMatchObject({ version: 2, placeholder: false });
    expect(confidentiality).toMatchObject({ version: 2, placeholder: false });
    expect(dataUse).toMatchObject({ version: 2, title: 'Admin text', placeholder: false });
  });

  it('a document with no approved file falls back to the placeholder; a bad file is refused', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'terms-'));
    writeFileSync(path.join(dir, 'contributor.json'), JSON.stringify({ title: 'Contributor', body: 'Approved contributor text for this test.' }));
    const { client } = await seed(db, { ...ENV, SEED_TERMS_DIR: dir });
    const [contributor, confidentiality] = await currentTerms(db, client.id);
    expect(contributor).toMatchObject({ placeholder: false, title: 'Contributor' });
    expect(confidentiality).toMatchObject({ placeholder: true });
    writeFileSync(path.join(dir, 'data_use.json'), JSON.stringify({ title: '', body: 'x' }));
    expect(() => readApprovedTerms(dir)).toThrow(/Bad approved terms file/);
    // The placeholder helper itself is unchanged for the tests and setup routes that need placeholders.
    await resetDb();
    const c = await db.client.create({ data: { name: 'Other' } });
    const u = await db.user.create({ data: { clientId: c.id, email: 'x@test.local', name: 'X', passwordHash: 'x', roles: ['ADMIN'] } });
    await seedPlaceholderTerms(db, c.id, u.id);
    expect((await currentTerms(db, c.id)).every((d) => d!.placeholder)).toBe(true);
  });
});
