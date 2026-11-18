import { randomUUID } from 'node:crypto';
import { checkGoldenPack, GoldenPack, packTarget, type GoldenPackCheck } from '@praxis/shared';
import { Prisma } from '@prisma/client';
import type { Db, Tx } from '../db';
import { jcsSha256 } from '../anvil/jcs';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError } from '../lib/errors';
import type { AuditInput } from '../platform/audit';
import { profileIdTaken } from './uploaded-profiles';

/** The form ID a pack declares, if any. */
export const packProfileId = (body: unknown): string | null => {
  const p = (body as { profile?: { profileId?: unknown } } | null)?.profile;
  return typeof p?.profileId === 'string' ? p.profileId : null;
};

/** Canonical (RFC 8785) SHA-256 of a form as the registry stores it (JSON values only). */
export const formSha256 = (profile: unknown) => jcsSha256(JSON.parse(JSON.stringify(profile)));

/**
 * TS-24 successor-version path (owner, 18 Nov 2026; RL Gym's v8 review: resolve TP_FORM_ID_TAKEN through the successor
 * path). A new version of a published template may keep its form ID when its form is byte-identical (same canonical
 * hash) to the form registered under that ID, for the same workflow, and that form is used by a PUBLISHED version of
 * this client. Returns the registered row to reuse, else null. A changed form never matches, so it still needs a new ID.
 */
export async function successorFormMatch(db: Db | Tx, clientId: string, body: unknown) {
  const probe = checkGoldenPack(body, () => false);
  if (!probe.profile) return null;
  const row = await db.uploadedProfile.findUnique({ where: { profileId: probe.profile.profileId } });
  if (!row || row.clientId !== clientId || row.workflowName.toLowerCase() !== probe.profile.catalogWorkflowName.toLowerCase()) return null;
  if (formSha256(row.profile) !== formSha256(probe.profile)) return null;
  const published = await db.template.count({ where: { clientId, profileId: row.profileId, status: 'PUBLISHED' } });
  return published ? row : null;
}

/**
 * Whether the pack's form ID is taken (built-in or stored; IDs are never reused). With `successorOf` (a new version of
 * an existing workflow), an identical registered form is not taken: the successor keeps its ID (TS-24).
 */
export async function formIdTaken(db: Db | Tx, body: unknown, successorOf?: { clientId: string }) {
  const id = packProfileId(body);
  if (!id || !(await profileIdTaken(db as Db, id))) return false;
  return !(successorOf && (await successorFormMatch(db, successorOf.clientId, body)));
}

/** Checks a pack against the forms already in use (built-in and stored). Read-only. */
export async function checkPack(db: Db | Tx, body: unknown, successorOf?: { clientId: string }): Promise<GoldenPackCheck> {
  const taken = await formIdTaken(db, body, successorOf);
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
  input: { clientId: string; uploaderId: string; body: unknown; audit: (a: AuditInput) => Promise<void>; anvilSpec?: Prisma.InputJsonValue; newVersionOfExisting?: boolean; from: 'golden_pack' | 'anvil_proposal' | 'praxis_form_revision' | 'praxis_successor_version' },
) {
  const successorOf = input.newVersionOfExisting ? { clientId: input.clientId } : undefined;
  const r = await checkPack(tx, input.body, successorOf);
  if (!r.ok || !r.profile) throw new AppError(422, 'INVALID_GOLDEN_PACK', 'The pack has problems; nothing was stored.', { problems: r.problems, examples: r.examples });
  const pack = GoldenPack.parse(input.body);
  const hash = sha256(stableStringify(input.body));
  // TS-24: a successor version with the identical registered form keeps it (the form registry is append-only by ID).
  const reused = successorOf ? await successorFormMatch(tx, input.clientId, input.body) : null;
  const row =
    reused ??
    (await tx.uploadedProfile.create({
      data: { clientId: input.clientId, profileId: r.profile.profileId, workflowName: r.profile.catalogWorkflowName, source: pack.source, profile: r.profile as object, examples: pack.examples as object[], contentHash: hash, uploadedById: input.uploaderId },
    }));
  if (reused) await input.audit({ entityType: 'UploadedProfile', entityId: row.id, action: 'template_profile.reused', after: { profileId: row.profileId, workflowName: row.workflowName, formSha256: formSha256(row.profile), from: input.from } });
  else await input.audit({ entityType: 'UploadedProfile', entityId: row.id, action: 'template_profile.uploaded', after: { profileId: row.profileId, workflowName: row.workflowName, source: row.source, examples: r.examples.length, contentHash: hash, from: input.from } });

  const latest = await tx.template.findFirst({ where: { clientId: input.clientId, workflowName: { equals: r.profile.catalogWorkflowName, mode: 'insensitive' } }, orderBy: { version: 'desc' } });
  let createdTemplateId: string | null = null;
  if (reused && !(latest && input.newVersionOfExisting)) throw new AppError(409, 'FORM_REUSE_NEEDS_SUCCESSOR', 'An existing form can be kept only by a new version of its published template.');
  if (!latest && pack.template) {
    const tpl = pack.template;
    const domain =
      (await tx.domain.findFirst({ where: { clientId: input.clientId, name: { equals: tpl.domainName, mode: 'insensitive' } } })) ??
      (await tx.domain.create({ data: { clientId: input.clientId, name: tpl.domainName } }));
    if (domain.status !== 'ACTIVE') throw new AppError(409, 'DOMAIN_RETIRED', `The domain ${domain.name} is retired.`);
    const t = await tx.template.create({
      data: {
        clientId: input.clientId, domainId: domain.id, workflowName: r.profile.catalogWorkflowName, lineageId: randomUUID(), version: 1, status: 'DRAFT', profileId: r.profile.profileId, agentMode: r.profile.agentMode,
        primaryWork: tpl.primaryWork, verificationCriteria: tpl.verificationCriteria, humanGate: tpl.humanGate, skills: [...new Set(tpl.skills)], defaultTptMinutes: tpl.defaultTptMinutes, taskModes: [...new Set(tpl.taskModes)],
        ...(tpl.coverageDimensions ? { coverageDimensions: tpl.coverageDimensions as object } : {}),
        ...(tpl.edgeCaseCatalog ? { edgeCaseCatalog: tpl.edgeCaseCatalog as object[] } : {}),
        ...(packTarget(tpl) !== null ? { defaultDistinctTarget: packTarget(tpl)! } : {}),
        ...(tpl.caseSelector ? { caseSelector: tpl.caseSelector as Prisma.InputJsonValue } : {}),
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
        // The version's agent mode follows its form (a multi-agent form makes it multi-agent).
        agentMode: r.profile.agentMode,
        anvilSpec: input.anvilSpec ?? (copy.anvilSpec as Prisma.InputJsonValue),
        caseSelector: copy.caseSelector === null ? Prisma.DbNull : (copy.caseSelector as Prisma.InputJsonValue),
        // A proposal's template block that states the cardinality replaces the copied one: a corrected template must
        // not inherit the previous version's target or quotas (KYC five-state contract: target 5, no additive quotas).
        ...cardinalityOf(pack.template),
      } as Prisma.TemplateUncheckedCreateInput,
    });
    createdTemplateId = t.id;
    await input.audit({ entityType: 'Template', entityId: t.id, action: 'template.version_created', before: { sourceId: latest.id, sourceVersion: latest.version }, after: { version: t.version, status: 'DRAFT', profileId: t.profileId, from: input.from } });
  }
  return { row, check: r, createdTemplateId };
}

/** Target and quotas a pack's template block sets for a new version (only what it states). */
function cardinalityOf(tpl: GoldenPack['template']) {
  if (!tpl) return {};
  const target = packTarget(tpl);
  return {
    ...(target !== null ? { defaultDistinctTarget: target } : {}),
    ...(tpl.coverageDimensions ? { coverageDimensions: tpl.coverageDimensions as Prisma.InputJsonValue } : {}),
    ...(tpl.edgeCaseCatalog ? { edgeCaseCatalog: tpl.edgeCaseCatalog as Prisma.InputJsonValue } : {}),
    // A stated template block decides the case selector too: a version without one must not inherit it.
    caseSelector: tpl.caseSelector ? (tpl.caseSelector as Prisma.InputJsonValue) : Prisma.DbNull,
  };
}
