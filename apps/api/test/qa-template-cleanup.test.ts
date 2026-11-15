import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { cleanupTemplates } from '../src/jobs/qa-template-cleanup';
import { db, resetDb } from './helpers';

/** QA template cleanup (owner, 15 Nov 2026): keep only the named Anvil templates; delete the rest, archive (retire) what can't be deleted. */
describe('qa-template-cleanup', () => {
  let clientId: string;
  let ids: Record<string, string>;

  beforeEach(async () => {
    await resetDb();
    const { client, admin } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@praxis.demo', SEED_ADMIN_PASSWORD: 'demo-admin-password-1', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    // seed() may create catalogue templates; start from a known set.
    await db.$executeRawUnsafe(`UPDATE "Template" SET variant_of_id = NULL`);
    const existing = await db.template.findMany({ select: { id: true } });
    for (const t of existing) {
      await db.$executeRawUnsafe(`DELETE FROM "CompilerGenerationRun" WHERE template_id = $1::uuid`, t.id);
      await db.$executeRawUnsafe(`DELETE FROM "TemplatePolicyProfile" WHERE template_id = $1::uuid`, t.id);
    }
    await db.$executeRawUnsafe(`DELETE FROM "Template"`).catch(() => undefined);
    const domain = await db.domain.create({ data: { clientId, name: `Banking ${randomUUID().slice(0, 6)}` } });
    const mk = async (name: string, extra: object = {}) => (await db.template.create({ data: { clientId, domainId: domain.id, lineageId: randomUUID(), workflowName: name, status: 'PUBLISHED', ...extra } })).id;
    const kycV6 = await mk('KYC v6 (Anvil)', { anvilSpec: { source: 'anvil' } });
    const kycLineage = (await db.template.findUniqueOrThrow({ where: { id: kycV6 } })).lineageId;
    const kycV5 = (await db.template.create({ data: { clientId, domainId: domain.id, lineageId: kycLineage, version: 0, workflowName: 'KYC v5 (Anvil)', status: 'PUBLISHED' } })).id;
    const marketing = await mk('Marketing (Anvil)', { anvilSpec: { source: 'anvil' } });
    const unused = await mk('Sanctions screening');
    const variant = await mk('Sanctions variant', { variantOfId: unused });
    const used = await mk('Audit prep');
    const pm = await db.user.findFirstOrThrow({ where: { id: admin.id } });
    await db.project.create({ data: { clientId, ownerId: pm.id, templateId: used, templateVersion: 1, name: 'Cancelled project with history', status: 'CANCELLED' } });
    ids = { kycV6, kycV5, marketing, unused, variant, used };
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('dry run lists every template with its fate and changes nothing', async () => {
    const before = await db.template.count();
    const r = await cleanupTemplates(db, { keep: [ids.kycV6!, ids.marketing!], apply: false });
    const by = Object.fromEntries(r.map((o) => [o.id, o]));
    expect(by[ids.kycV6!]).toMatchObject({ outcome: 'kept', fromAnvil: true });
    expect(by[ids.marketing!]).toMatchObject({ outcome: 'kept', fromAnvil: true });
    expect(by[ids.kycV5!]!.outcome).toBe('kept_same_lineage');
    expect(by[ids.unused!]!.outcome).toBe('would_delete');
    expect(by[ids.variant!]!.outcome).toBe('would_delete');
    expect(by[ids.used!]).toMatchObject({ outcome: 'would_retire', reasons: ['1 projects'] });
    expect(await db.template.count()).toBe(before);
    expect(await db.auditEvent.count({ where: { entityType: 'Template' } })).toBe(0);
  });

  it('keeps the named templates and their lineage, deletes unused ones, archives (retires) the rest; audited and idempotent', async () => {
    const r = await cleanupTemplates(db, { keep: [ids.kycV6!, ids.marketing!], apply: true });
    const by = Object.fromEntries(r.map((o) => [o.id, o.outcome]));
    expect(by[ids.unused!]).toBe('deleted');
    expect(by[ids.variant!]).toBe('deleted');
    expect(by[ids.used!]).toBe('retired');
    expect(await db.template.findUnique({ where: { id: ids.unused! } })).toBeNull();
    expect(await db.template.findUniqueOrThrow({ where: { id: ids.used! } })).toMatchObject({ status: 'RETIRED' });
    for (const k of [ids.kycV6!, ids.marketing!, ids.kycV5!]) expect(await db.template.findUniqueOrThrow({ where: { id: k } })).toMatchObject({ status: 'PUBLISHED', retiredAt: null });
    expect(await db.project.count()).toBe(1);
    const audits = await db.auditEvent.findMany({ where: { entityType: 'Template' } });
    expect(audits.map((a) => a.action).sort()).toEqual(['template.hard_deleted', 'template.hard_deleted', 'template.retired']);
    expect(audits.every((a) => a.actorType === 'SYSTEM' && a.actorId === 'qa-template-cleanup')).toBe(true);
    const again = await cleanupTemplates(db, { keep: [ids.kycV6!, ids.marketing!], apply: true });
    expect(again.find((o) => o.id === ids.used)!.outcome).toBe('already_retired');
    expect(await db.auditEvent.count({ where: { entityType: 'Template' } })).toBe(3);
  });

  it('refuses to remove every template, and names a keep id it cannot find', async () => {
    await expect(cleanupTemplates(db, { keep: [], apply: true })).rejects.toThrow(/refusing to remove every template/);
    await expect(cleanupTemplates(db, { keep: [randomUUID()], apply: false })).rejects.toThrow(/not found/);
    expect(await db.template.count()).toBe(6);
  });
});
