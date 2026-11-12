import { randomUUID } from 'node:crypto';
import { checkGoldenPack, GoldenPack, type GoldenPackCheck } from '@praxis/shared';
import type { Prisma } from '@prisma/client';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError } from '../lib/errors';
import type { AuditInput } from '../platform/audit';
import { profileIdTaken } from './uploaded-profiles';

/** The form ID a pack declares, if any. */
export const packProfileId = (body: unknown): string | null => {
  const p = (body as { profile?: { profileId?: unknown } } | null)?.profile;
  return typeof p?.profileId === 'string' ? p.profileId : null;
};

/** Checks a pack against the forms already in use (built-in and stored). Read-only. */
export async function checkPack(db: Db | Tx, body: unknown): Promise<GoldenPackCheck> {
  const id = packProfileId(body);
  const taken = id ? await profileIdTaken(db as Db, id) : false;
  return checkGoldenPack(body, () => taken);
}

/**
 * Stores a golden task pack (append-only) and creates the draft template version that uses its form:
 *  - a new workflow (the pack must then describe its template) gets version 1;
 *  - an existing workflow gets a new DRAFT version of its latest version, when `newVersionOfExisting` is set
 *    (Anvil proposals). Console uploads leave existing workflows to the Admin, as before.
 * `anvilSpec` (Anvil-owned execution part, skills, requirement) is stored unchanged on the draft.
 */
export async function storePack(
  tx: Tx,
  input: { clientId: string; uploaderId: string; body: unknown; audit: (a: AuditInput) => Promise<void>; anvilSpec?: Prisma.InputJsonValue; newVersionOfExisting?: boolean; from: 'golden_pack' | 'anvil_proposal' },
) {
  const r = await checkPack(tx, input.body);
  if (!r.ok || !r.profile) throw new AppError(422, 'INVALID_GOLDEN_PACK', 'The pack has problems; nothing was stored.', { problems: r.problems, examples: r.examples });
  const pack = GoldenPack.parse(input.body);
  const hash = sha256(stableStringify(input.body));
  const row = await tx.uploadedProfile.create({
    data: { clientId: input.clientId, profileId: r.profile.profileId, workflowName: r.profile.catalogWorkflowName, source: pack.source, profile: r.profile as object, examples: pack.examples as object[], contentHash: hash, uploadedById: input.uploaderId },
  });
  await input.audit({ entityType: 'UploadedProfile', entityId: row.id, action: 'template_profile.uploaded', after: { profileId: row.profileId, workflowName: row.workflowName, source: row.source, examples: r.examples.length, contentHash: hash, from: input.from } });

  const latest = await tx.template.findFirst({ where: { clientId: input.clientId, workflowName: { equals: r.profile.catalogWorkflowName, mode: 'insensitive' } }, orderBy: { version: 'desc' } });
  let createdTemplateId: string | null = null;
  if (!latest && pack.template) {
    const tpl = pack.template;
    const domain =
      (await tx.domain.findFirst({ where: { clientId: input.clientId, name: { equals: tpl.domainName, mode: 'insensitive' } } })) ??
      (await tx.domain.create({ data: { clientId: input.clientId, name: tpl.domainName } }));
    if (domain.status !== 'ACTIVE') throw new AppError(409, 'DOMAIN_RETIRED', `The domain ${domain.name} is retired.`);
    const t = await tx.template.create({
      data: {
        clientId: input.clientId, domainId: domain.id, workflowName: r.profile.catalogWorkflowName, lineageId: randomUUID(), version: 1, status: 'DRAFT', profileId: r.profile.profileId,
        primaryWork: tpl.primaryWork, verificationCriteria: tpl.verificationCriteria, humanGate: tpl.humanGate, skills: [...new Set(tpl.skills)], defaultTptMinutes: tpl.defaultTptMinutes, taskModes: [...new Set(tpl.taskModes)],
        ...(tpl.coverageDimensions ? { coverageDimensions: tpl.coverageDimensions as object } : {}),
        ...(tpl.edgeCaseCatalog ? { edgeCaseCatalog: tpl.edgeCaseCatalog as object[] } : {}),
        ...(input.anvilSpec !== undefined ? { anvilSpec: input.anvilSpec } : {}),
      },
    });
    createdTemplateId = t.id;
    await input.audit({ entityType: 'Template', entityId: t.id, action: 'template.created', after: { workflowName: t.workflowName, domainName: domain.name, version: 1, status: 'DRAFT', profileId: t.profileId, from: input.from } });
  } else if (latest && input.newVersionOfExisting) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'template-lineage:' + latest.lineageId}))`;
    const draft = await tx.template.findFirst({ where: { lineageId: latest.lineageId, status: 'DRAFT' } });
    if (draft) throw new AppError(409, 'DRAFT_EXISTS', `Version ${draft.version} of this workflow is already a draft; the Praxis Admin must publish or retire it first.`);
    const { id: _i, createdAt: _c, updatedAt: _u, publishedAt: _p, retiredAt: _r, blueprint: _b, ...copy } = latest;
    void _i; void _c; void _u; void _p; void _r; void _b;
    const t = await tx.template.create({
      data: {
        ...copy,
        taskDefinitionSchema: copy.taskDefinitionSchema as Prisma.InputJsonValue,
        collectionSchema: copy.collectionSchema as Prisma.InputJsonValue,
        coverageDimensions: copy.coverageDimensions as Prisma.InputJsonValue,
        edgeCaseCatalog: copy.edgeCaseCatalog as Prisma.InputJsonValue,
        version: latest.version + 1,
        status: 'DRAFT',
        profileId: r.profile.profileId,
        anvilSpec: input.anvilSpec ?? (copy.anvilSpec as Prisma.InputJsonValue),
      } as Prisma.TemplateUncheckedCreateInput,
    });
    createdTemplateId = t.id;
    await input.audit({ entityType: 'Template', entityId: t.id, action: 'template.version_created', before: { sourceId: latest.id, sourceVersion: latest.version }, after: { version: t.version, status: 'DRAFT', profileId: t.profileId, from: input.from } });
  }
  return { row, check: r, createdTemplateId };
}
