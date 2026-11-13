import { checkGoldenPack, checkTemplateSpec, FIELD_TYPES, GOLDEN_PACK_SCHEMA_VERSION, PROFILE_SCHEMA_VERSION, profileById, TEMPLATE_SPEC_SCHEMA, TemplateSpec, templateVersionContent, type TemplateSpecCheck } from '@praxis/shared';
import type { Prisma, Template } from '@prisma/client';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiClientActor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import type { AuditInput } from '../platform/audit';
import { runStaffOrServiceCommand } from '../platform/command';
import { packProfileId, storePack } from '../templates/golden-pack-store';
import { loadUploadedProfiles, profileIdTaken } from '../templates/uploaded-profiles';
import { jcsSha256 } from '../anvil/jcs';
import { checkJointProposal, EXECUTION_SCHEMAS, isJointProposal, JOINT_KEYS, JOINT_TEMPLATE_SPEC, jointHashes, jointTemplateSpec, jointToolIds, type StoredJointParts } from '../anvil/joint-template';

/**
 * Praxis template API for Anvil (Praxis-Anvil contract, approved 12 Nov 2026, docs/anvil/PRAXIS-ANVIL-CONTRACT-FINAL.md
 * section 5). Anvil starts every new template or change; Praxis checks authorability, stores the proposal append-only,
 * creates a DRAFT template version for a Praxis Admin to publish, and records Anvil's qualification receipts.
 * Only an ANVIL API key (Praxis-issued, expiring) may call these routes. No model is ever called here.
 */
const ANVIL = { roles: [] as const, apiClient: 'ANVIL' as const };
const MAX_BYTES = 2_000_000;
/** Below this many eligible people for a role profile, Praxis reports that recruitment is needed (advice only). */
const SUPPLY_MIN = 3;

const envelope = (requestId: string, data: object) => ({ data, meta: { request_id: requestId } });

/** The contract (section 5) answers a reused Idempotency-Key with a different body with 409, as Anvil's own API does. */
async function asContract(run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    if (e instanceof AppError && e.code === 'IDEMPOTENCY_KEY_REUSED') throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used with a different body; use a fresh key for a changed proposal.');
    throw e;
  }
}

/** Staffing feasibility (counts only, never personal data): Praxis-side work, not Anvil errors. */
async function staffingAdvice(db: Db | Tx, clientId: string, spec: { skills: { authoring: { mandatory: string[]; certifications?: string[] }; reviewing: { mandatory: string[]; certifications?: string[] } } }) {
  const out: { code: string; message: string; counts?: Record<string, number> }[] = [];
  const count = async (skills: string[]) => (skills.length ? db.candidate.count({ where: { clientId, OR: [{ skills: { hasSome: skills } }, { specialties: { hasSome: skills } }] } }) : 0);
  const authors = await count(spec.skills.authoring.mandatory);
  const reviewers = await count(spec.skills.reviewing.mandatory);
  const validators = await db.user.count({ where: { clientId, roles: { has: 'REVIEWER' }, status: 'ACTIVE' } });
  const counts = { eligibleAuthors: authors, eligibleReviewerCandidates: reviewers, activeValidators: validators };
  if (authors < SUPPLY_MIN) out.push({ code: 'PR_RECRUITMENT_NEEDED', message: `Praxis has ${authors} candidate(s) with the authoring skills; recruitment is needed before staffing.`, counts });
  if (reviewers < SUPPLY_MIN && validators < 1) out.push({ code: 'PR_SUPPLY_INSUFFICIENT', message: 'Praxis has too few reviewers with the reviewing skills; reviewer recruitment is needed.', counts });
  if (spec.skills.authoring.certifications?.length || spec.skills.reviewing.certifications?.length) out.push({ code: 'PR_CERTIFICATION_NEEDED', message: 'The proposal asks for certifications; Praxis certifies SMEs before staffing.', counts });
  if (!out.length) out.push({ code: 'PR_SUPPLY_OK', message: 'Praxis has people with these skills; staffing is decided per project.', counts });
  return out;
}

type Checked = TemplateSpecCheck & { spec: TemplateSpec | null; joint: StoredJointParts | null; pack: TemplateSpecCheck['pack']; packBody: unknown };

/** Golden-pack problems as template-proposal errors (same mapping for both proposal formats). */
function packIssues(problems: string[], pointer: string) {
  return problems.map((p) => {
    const code = /unsupported field type/.test(p) ? 'TP_FIELD_TYPE_UNSUPPORTED' : /^example/.test(p) ? 'TP_EXAMPLE_INVALID' : /weight/i.test(p) ? 'TP_CRITERIA_WEIGHTS' : /already in use/.test(p) ? 'TP_FORM_ID_TAKEN' : 'TP_FORM_INVALID';
    return { code, owner: 'anvil' as const, file: 'template-spec.json', pointer, message: p, fix: code === 'TP_FORM_ID_TAKEN' ? 'Give a changed form a new ID; IDs are never reused.' : 'Repair the authoring part as described.' };
  });
}

/**
 * Authorability check of a proposal in either format: the joint `praxis.anvil.template-spec.v1` (Anvil's four
 * confirmations, 11 Nov 2026) or the earlier `praxis.template_spec.v1-proposed`, kept for proposals already made.
 */
async function check(db: Db | Tx, clientId: string, body: unknown): Promise<Checked> {
  await loadUploadedProfiles(db as Db);
  let r: TemplateSpecCheck;
  let spec: TemplateSpec | null = null;
  let joint: StoredJointParts | null = null;
  let packBody: unknown = null;
  let skills: Parameters<typeof staffingAdvice>[2]['skills'] | null = null;
  if (isJointProposal(body)) {
    const j = checkJointProposal(body as Record<string, unknown>);
    if (!j.parts) return { valid: false, errors: j.issues, praxisRequirements: [], pack: null, spec: null, joint: null, packBody: null };
    const id = packProfileId(j.pack);
    const taken = id ? await profileIdTaken(db as Db, id) : false;
    const pack = checkGoldenPack(j.pack, () => taken);
    const errors = [...j.issues, ...packIssues(pack.problems, '/authoring')];
    if (pack.profile) {
      const s3 = pack.profile.sections.find((s) => s.key === 'S3');
      const offered = (s3?.fields.find((f) => f.key === 'tools')?.options ?? []).map((o) => o.value);
      const described = new Set(jointToolIds(j.parts));
      for (const t of offered) if (!described.has(t)) errors.push({ code: 'TP_TOOL_SCHEMA_MISSING', owner: 'anvil', file: 'template-spec.json', pointer: '/execution/tools', message: `Tool "${t}" is offered by the form but has no schemas in the execution part.`, fix: 'Add the tool (id, input_schema, output_schema, error_schema) to execution.tools.' });
    }
    r = { valid: errors.length === 0, errors, praxisRequirements: [], pack };
    joint = j.parts;
    packBody = j.pack;
    skills = j.parts.skills as unknown as NonNullable<typeof skills>;
  } else {
    const parsed = TemplateSpec.safeParse(body);
    const id = parsed.success ? packProfileId(parsed.data.pack) : null;
    const taken = id ? await profileIdTaken(db as Db, id) : false;
    r = checkTemplateSpec(body, () => taken);
    if (parsed.success) {
      spec = parsed.data;
      packBody = parsed.data.pack;
      skills = parsed.data.skills;
    }
  }
  if (packBody && r.pack?.profile) {
    // A new workflow needs its template in the pack; an existing one gets a new version.
    const exists = await db.template.count({ where: { clientId, workflowName: { equals: r.pack.profile.catalogWorkflowName, mode: 'insensitive' } } });
    const hasTemplate = !!(packBody as { template?: unknown }).template;
    if (!exists && !hasTemplate) r.errors.push({ code: 'TP_TEMPLATE_MISSING', owner: 'anvil', file: 'template-spec.json', pointer: joint ? '/authoring/template' : '/pack/template', message: `The workflow "${r.pack.profile.catalogWorkflowName}" is new to Praxis and the proposal has no template block.`, fix: 'Add the template block (domain, primary work, verification criteria, human gate, TPT, coverage).' });
    r.valid = r.errors.length === 0;
  }
  if (skills) r.praxisRequirements = await staffingAdvice(db, clientId, { skills });
  return { ...r, spec, joint, packBody };
}

/**
 * The hash both sides accept for a template version. A joint template (praxis.anvil.template-spec.v1) uses the agreed
 * whole-spec hash `template_sha256`; an earlier proposal keeps its original version hash.
 */
export function templateVersionHash(t: Pick<Template, 'workflowName' | 'version' | 'profileId' | 'anvilSpec' | 'lineageId'>) {
  const joint = jointTemplateSpec(t);
  if (joint) return jointHashes(joint).template_sha256;
  const spec = (t.anvilSpec ?? {}) as { execution?: unknown; skills?: unknown };
  return sha256(templateVersionContent({ workflowName: t.workflowName, version: t.version, profile: t.profileId ? (profileById(t.profileId) ?? null) : null, execution: spec.execution ?? null, skills: spec.skills ?? null }));
}

/** A revocation delivered in Anvil's envelope (four confirmations, point 4) revokes one receipt; an earlier REVOKED row revokes all. */
const revokedReceipt = (receipt: unknown) => {
  const r = receipt as { kind?: unknown; event?: { receipt_id?: unknown } } | null;
  return r?.kind === 'revocation' && typeof r.event?.receipt_id === 'string' ? r.event.receipt_id : null;
};

/**
 * Anvil readiness of one template version: its hash and whether a qualification for that exact hash still stands.
 * Revoking an old receipt never revokes an unrelated newer receipt.
 */
export async function anvilReadiness(db: Db | Tx, t: Template) {
  const versionHash = templateVersionHash(t);
  const rows = await db.templateQualification.findMany({ where: { templateId: t.id, templateVersionHash: versionHash }, orderBy: { createdAt: 'asc' } });
  let standing: typeof rows = [];
  for (const q of rows) {
    if (q.status === 'QUALIFIED') standing.push(q);
    else {
      const one = revokedReceipt(q.receipt);
      standing = one ? standing.filter((s) => s.receiptId !== one) : [];
    }
  }
  const current = standing.at(-1);
  const qualification = current ? 'qualified' : rows.length ? 'revoked' : 'none';
  return { versionHash, proposedByAnvil: !!t.anvilSpec, qualification, receiptId: current?.receiptId ?? null, qualifiedAt: current?.createdAt.toISOString() ?? null, anvilReady: t.status === 'PUBLISHED' && qualification === 'qualified' };
}

const proposalStatus = (t: Template | null) => (!t ? 'missing' : t.status === 'DRAFT' ? 'draft_created' : t.status === 'PUBLISHED' ? 'published' : 'retired');

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
/** Anvil's revocation event (anvil.template-revocation.v1), exactly as Anvil publishes it. */
const RevocationEvent = z
  .object({
    schema_version: z.literal('anvil.template-revocation.v1'),
    event_id: z.string().uuid(),
    environment: z.enum(['qa', 'staging', 'local']),
    project_id: z.string().uuid(),
    anvil_template_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/),
    template_id: z.string().uuid(),
    version: z.number().int().min(1),
    template_sha256: Hash,
    receipt_id: z.string().uuid(),
    receipt_hash: Hash,
    status: z.literal('revoked'),
    reason: z.string().min(1).max(1000),
    sequence: z.number().int().min(1),
  })
  .strict();
const QualificationBody = z.union([
  z.object({ kind: z.literal('revocation'), event: z.record(z.string(), z.unknown()), event_sha256: Hash }).strict(),
  z
    .object({
      template_id: z.string().uuid(),
      /** Joint templates: the template version. `template_id` is then the stable template ID (lineage). */
      version: z.number().int().min(1).optional(),
      template_version_hash: Hash,
      status: z.enum(['QUALIFIED', 'REVOKED']),
      receipt_id: z.string().trim().min(1).max(200),
      receipt: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);

/** The Anvil project this environment exports to (from ANVIL_EXPORT_BASE_URL, `/projects/{id}/...`). */
const anvilProjectOf = (baseUrl: string) => /\/projects\/([0-9a-f-]{36})(\/|$)/i.exec(baseUrl)?.[1]?.toLowerCase() ?? null;

export const anvilTemplateRoutes: FastifyPluginAsyncZod<{ db: Db; anvil?: { environment: string; exportBaseUrl: string } }> = async (app, { db, anvil: binding }) => {
  const client = (req: { apiClient: ApiClientActor | null }) => {
    if (!req.apiClient) throw new AppError(401, 'UNAUTHENTICATED', 'An Anvil API key is required.');
    return req.apiClient;
  };

  app.get('/integrations/anvil/templates/contracts', { config: { access: ANVIL }, schema: { tags: ['anvil'] } }, async (req) =>
    envelope(req.id, {
      template_spec_schema_versions: [JOINT_TEMPLATE_SPEC, TEMPLATE_SPEC_SCHEMA],
      joint_template_spec: {
        schema_version: JOINT_TEMPLATE_SPEC,
        top_level_keys: JOINT_KEYS,
        proposal_keys: JOINT_KEYS.filter((k) => k !== 'template_id' && k !== 'version'),
        hashing: 'lowercase_hex(SHA256(UTF8(RFC8785(value))))',
        part_hash_keys: ['authoring', 'execution', 'skills'],
        identity: 'template_id = Praxis stable template UUID (lineage), version = positive integer, both assigned by Praxis',
      },
      execution_schema_versions: EXECUTION_SCHEMAS,
      authoring_schema: AUTHORING_SCHEMA,
      pack_schema_version: GOLDEN_PACK_SCHEMA_VERSION,
      profile_schema_version: PROFILE_SCHEMA_VERSION,
      field_types: FIELD_TYPES,
      limits: { maximum_upload_bytes: MAX_BYTES, maximum_examples: 20 },
      revocation: { schema_version: 'anvil.template-revocation.v1', endpoint: 'POST /api/v1/integrations/anvil/templates/qualifications', acknowledgement: ['event_id', 'event_sha256', 'status', 'sequence'] },
      error_codes: ['TP_SCHEMA_VERSION', 'TP_SPEC_SHAPE', 'TP_FORM_INVALID', 'TP_FORM_ID_TAKEN', 'TP_FIELD_TYPE_UNSUPPORTED', 'TP_CRITERIA_WEIGHTS', 'TP_EXAMPLE_INVALID', 'TP_SKILLS_MISSING', 'TP_EVALUATOR_KIND_UNKNOWN', 'TP_TOOL_SCHEMA_MISSING', 'TP_OUTPUT_SCHEMA', 'TP_TEMPLATE_MISSING'],
      praxis_requirement_codes: ['PR_RECRUITMENT_NEEDED', 'PR_SUPPLY_INSUFFICIENT', 'PR_CERTIFICATION_NEEDED', 'PR_SUPPLY_OK'],
      paid_calls: false,
    }),
  );

  app.post('/integrations/anvil/templates/validate', { config: { access: ANVIL }, bodyLimit: MAX_BYTES, schema: { tags: ['anvil'], body: z.record(z.string(), z.unknown()) } }, async (req, reply) => {
    const c = client(req);
    const r = await check(db, c.clientId, req.body);
    return reply.status(r.valid ? 200 : 422).send(
      envelope(req.id, {
        schema_version: 'praxis.template-validation.v1',
        valid: r.valid,
        status: r.valid ? 'template_authorable' : 'template_invalid',
        errors: r.errors,
        error_count: r.errors.length,
        praxis_requirements: r.praxisRequirements,
        review_gates: [{ code: 'REVIEW_DOMAIN_OWNER', message: 'A domain owner signs off the authoring part.' }, { code: 'REVIEW_PRAXIS_PUBLISH', message: 'A Praxis Admin publishes the template version.' }],
        examples: r.pack?.examples ?? [],
        paid_calls: false,
      }),
    );
  });

  app.post('/integrations/anvil/templates/proposals', { config: { access: ANVIL }, bodyLimit: MAX_BYTES, schema: { tags: ['anvil'], body: z.record(z.string(), z.unknown()) } }, async (req, reply) => {
    const c = client(req);
    await asContract(() => runStaffOrServiceCommand(db, req, reply, async ({ tx, audit }) => {
      const r = await check(tx, c.clientId, req.body);
      if (!r.valid || (!r.spec && !r.joint)) {
        return { status: 422, body: envelope(req.id, { schema_version: 'praxis.template-validation.v1', valid: false, status: 'template_invalid', errors: r.errors, error_count: r.errors.length, praxis_requirements: r.praxisRequirements, review_gates: [], paid_calls: false }) };
      }
      // Joint proposals: the parts are stored exactly as received, so both sides hash the same object.
      const anvilSpec = (r.joint ?? { requirement: r.spec!.requirement, execution: r.spec!.execution, skills: r.spec!.skills }) as unknown as Prisma.InputJsonValue;
      const stored = await storePack(tx, { clientId: c.clientId, uploaderId: c.apiClientId, body: r.packBody, audit, anvilSpec, newVersionOfExisting: true, from: 'anvil_proposal' });
      if (!stored.createdTemplateId) throw new AppError(500, 'NO_DRAFT', 'The proposal was stored but no draft template version was created.');
      const authoringSkills = r.joint ? ((r.joint.skills.authoring as { mandatory: string[] }).mandatory ?? []) : r.spec!.skills.authoring.mandatory;
      // The template's skills drive the generated JDs: the authoring skills from Anvil (reviewer JD adds experience).
      const draft = await tx.template.update({ where: { id: stored.createdTemplateId }, data: { skills: [...new Set(authoringSkills)] } });
      const requirementId = r.joint ? String((r.joint.requirement as { id?: unknown; reference?: unknown }).id ?? (r.joint.requirement as { reference?: unknown }).reference ?? r.joint.anvil_template_key) : r.spec!.requirement.id;
      const proposal = await tx.templateProposal.create({
        data: { clientId: c.clientId, apiClientId: c.apiClientId, requirementId: requirementId.slice(0, 200), profileId: stored.row.profileId, templateId: draft.id, spec: req.body as Prisma.InputJsonValue, specSha256: r.joint ? jcsSha256(req.body) : sha256(stableStringify(req.body)) },
      });
      await audit({ entityType: 'TemplateProposal', entityId: proposal.id, action: 'template_proposal.received', after: { requirementId: proposal.requirementId, profileId: proposal.profileId, templateId: draft.id, version: draft.version, specSha256: proposal.specSha256, ...(r.joint ? { anvilTemplateKey: r.joint.anvil_template_key, lineageId: draft.lineageId } : {}) } });
      const identity = r.joint ? { anvil_template_key: r.joint.anvil_template_key, template_id: draft.lineageId, version: draft.version, template_version_id: draft.id } : { template_id: draft.id };
      return { status: 201, body: envelope(req.id, { proposal_id: proposal.id, status: 'draft_created', ...identity, template_version: draft.version, workflow: draft.workflowName, profile_id: proposal.profileId, praxis_requirements: r.praxisRequirements, review_gates: [{ code: 'REVIEW_PRAXIS_PUBLISH', message: 'A Praxis Admin completes and publishes the draft; nothing goes live from the API.' }] }) };
    }));
    await loadUploadedProfiles(db);
    return reply;
  });

  app.get('/integrations/anvil/templates/proposals/:id', { config: { access: ANVIL }, schema: { tags: ['anvil'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const c = client(req);
    const p = await db.templateProposal.findFirst({ where: { id: req.params.id, clientId: c.clientId } });
    if (!p) throw notFound('Proposal not found');
    const t = await db.template.findUnique({ where: { id: p.templateId } });
    const ready = t ? await anvilReadiness(db, t) : null;
    const joint = t ? jointTemplateSpec(t) : null;
    if (t && joint) {
      // Four confirmations, point 1: the spec, its whole hash, the three part hashes and publication status, separately.
      // A draft's object is a candidate: its hash may change before publication and is never the published hash.
      const hashes = jointHashes(joint);
      return envelope(req.id, {
        proposal_id: p.id,
        requirement_id: p.requirementId,
        status: proposalStatus(t),
        publication_status: t.status === 'PUBLISHED' ? 'published' : t.status === 'DRAFT' ? 'candidate' : 'retired',
        anvil_template_key: joint.anvil_template_key,
        template_id: joint.template_id,
        version: joint.version,
        template_version_id: t.id,
        profile_id: p.profileId,
        template_spec: joint,
        template_sha256: hashes.template_sha256,
        part_hashes: hashes.part_hashes,
        template_version_hash: t.status === 'PUBLISHED' ? hashes.template_sha256 : null,
        qualification: ready?.qualification ?? 'none',
      });
    }
    return envelope(req.id, { proposal_id: p.id, requirement_id: p.requirementId, status: proposalStatus(t), template_id: p.templateId, template_version: t?.version ?? null, profile_id: p.profileId, template_version_hash: t?.status === 'PUBLISHED' ? ready!.versionHash : null, qualification: ready?.qualification ?? 'none' });
  });

  /** Console: whether a template version is Anvil-ready for benchmarks (published and qualified for its exact hash). */
  app.get('/templates/:id/anvil', { config: { access: ['ADMIN', 'PM'] }, schema: { tags: ['templates'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const t = await db.template.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId } });
    if (!t) throw notFound('Template not found');
    const spec = (t.anvilSpec ?? null) as { requirement?: { id?: string; channel?: string; reference?: string }; anvil_template_key?: string } | null;
    return { ...(await anvilReadiness(db, t)), requirementId: spec?.requirement?.id ?? spec?.requirement?.reference ?? null, channel: spec?.requirement?.channel ?? null, anvilTemplateKey: spec?.anvil_template_key ?? null };
  });

  app.post('/integrations/anvil/templates/qualifications', { config: { access: ANVIL }, schema: { tags: ['anvil'], body: QualificationBody } }, async (req, reply) => {
    const c = client(req);
    const body = req.body;
    if ('kind' in body) {
      await asContract(() => runStaffOrServiceCommand(db, req, reply, async ({ tx, audit }) => applyRevocation(tx, c, body, audit, req.id)));
      return reply;
    }
    await asContract(() => runStaffOrServiceCommand(db, req, reply, async ({ tx, audit }) => {
      const t = body.version !== undefined ? await tx.template.findFirst({ where: { lineageId: body.template_id, version: body.version, clientId: c.clientId } }) : await tx.template.findFirst({ where: { id: body.template_id, clientId: c.clientId } });
      if (!t) throw notFound('Template not found');
      if (t.status !== 'PUBLISHED' && body.status === 'QUALIFIED') throw new AppError(409, 'TEMPLATE_NOT_PUBLISHED', 'Only a published template version can be qualified.');
      const hash = templateVersionHash(t);
      if (hash !== body.template_version_hash) throw new AppError(409, 'TEMPLATE_VERSION_MISMATCH', 'The receipt is for different template content than this version holds.', { expected: hash });
      const q = await tx.templateQualification.create({ data: { clientId: c.clientId, templateId: t.id, templateVersionHash: hash, status: body.status, receiptId: body.receipt_id, receipt: body.receipt as Prisma.InputJsonValue, apiClientId: c.apiClientId } });
      await audit({ entityType: 'Template', entityId: t.id, action: body.status === 'QUALIFIED' ? 'template.anvil_qualified' : 'template.anvil_qualification_revoked', after: { qualificationId: q.id, receiptId: q.receiptId, templateVersionHash: hash } });
      return { status: 201, body: envelope(req.id, { qualification_id: q.id, template_id: body.version !== undefined ? t.lineageId : t.id, ...(body.version !== undefined ? { version: t.version, template_version_id: t.id } : {}), template_version_hash: hash, status: q.status, recorded_at: q.createdAt.toISOString() }) };
    }));
    return reply;
  });

  /**
   * Anvil's revocation event (four confirmations, point 4). Authentication binds the Anvil project and environment;
   * body identifiers alone confer no authority. Idempotent per event: a repeat (any Idempotency-Key) is acknowledged as
   * already applied, the same event ID or sequence with other content is a conflict, and an older event for a receipt
   * never reopens it. Every project pinned to the version is flagged in the audit log; authoring, history and scores
   * are kept unchanged.
   */
  async function applyRevocation(tx: Tx, c: ApiClientActor, body: { event: Record<string, unknown>; event_sha256: string }, audit: (a: AuditInput) => Promise<void>, requestId: string) {
    const parsed = RevocationEvent.safeParse(body.event);
    if (!parsed.success) throw new AppError(422, 'REVOCATION_EVENT_INVALID', 'The revocation event does not follow anvil.template-revocation.v1.', { issues: parsed.error.issues.map((i) => `/${i.path.join('/')}`) });
    const e = parsed.data;
    let computed: string;
    try {
      computed = jcsSha256(body.event);
    } catch {
      throw new AppError(422, 'REVOCATION_EVENT_INVALID', 'The revocation event cannot be canonicalised (RFC 8785).');
    }
    if (computed !== body.event_sha256) throw new AppError(422, 'EVENT_HASH_MISMATCH', 'event_sha256 is not the RFC 8785 SHA-256 of event.');
    const project = binding ? anvilProjectOf(binding.exportBaseUrl) : null;
    if (!binding?.environment || !project) throw new AppError(409, 'ANVIL_STREAM_UNBOUND', 'This Praxis environment is not bound to an Anvil project and environment (ANVIL_ENVIRONMENT, ANVIL_EXPORT_BASE_URL); revocations cannot be accepted.');
    if (e.environment !== binding.environment || e.project_id.toLowerCase() !== project) throw new AppError(409, 'ANVIL_STREAM_MISMATCH', 'The event is for a different Anvil environment or project than this Praxis environment is bound to.');
    const ack = (status: 'applied' | 'already_applied') => ({ status: 200, body: envelope(requestId, { event_id: e.event_id, event_sha256: computed, status, sequence: e.sequence }) });

    const same = await tx.anvilRevocationEvent.findUnique({ where: { eventId: e.event_id } });
    if (same) {
      if (same.eventSha256 !== computed) throw new AppError(409, 'EVENT_CONFLICT', 'This event ID was already received with different content.');
      await audit({ entityType: 'Template', entityId: same.templateId, action: 'template.anvil_revocation_repeated', after: { receiptId: e.receipt_id, eventId: e.event_id, sequence: e.sequence } });
      return ack('already_applied');
    }
    const seq = await tx.anvilRevocationEvent.findFirst({ where: { environment: e.environment, anvilProjectId: e.project_id.toLowerCase(), sequence: e.sequence } });
    if (seq) throw new AppError(409, 'EVENT_CONFLICT', 'This sequence number was already used by a different event in this Anvil project stream.');

    const t = await tx.template.findFirst({ where: { lineageId: e.template_id, version: e.version, clientId: c.clientId } });
    if (!t) throw notFound('Template version not found');
    const hash = templateVersionHash(t);
    if (hash !== e.template_sha256) throw new AppError(409, 'TEMPLATE_VERSION_MISMATCH', 'template_sha256 is not the published hash of this template version.');
    const original = await tx.templateQualification.findFirst({ where: { templateId: t.id, receiptId: e.receipt_id, status: 'QUALIFIED' } });
    if (original && jcsSha256(original.receipt) !== e.receipt_hash) throw new AppError(409, 'RECEIPT_HASH_MISMATCH', 'receipt_hash does not match the qualification receipt Praxis holds.');
    const earlier = await tx.anvilRevocationEvent.findFirst({ where: { receiptId: e.receipt_id, environment: e.environment, anvilProjectId: e.project_id.toLowerCase() }, orderBy: { sequence: 'desc' } });
    const outcome = earlier ? 'already_applied' : 'applied';
    await tx.anvilRevocationEvent.create({ data: { clientId: c.clientId, apiClientId: c.apiClientId, eventId: e.event_id, environment: e.environment, anvilProjectId: e.project_id.toLowerCase(), receiptId: e.receipt_id, sequence: e.sequence, templateId: t.id, eventSha256: computed, event: body.event as Prisma.InputJsonValue, outcome } });
    if (outcome === 'applied') {
      const q = await tx.templateQualification.create({ data: { clientId: c.clientId, templateId: t.id, templateVersionHash: hash, status: 'REVOKED', receiptId: e.receipt_id, receipt: { kind: 'revocation', event: body.event, event_sha256: computed } as Prisma.InputJsonValue, apiClientId: c.apiClientId } });
      await audit({ entityType: 'Template', entityId: t.id, action: 'template.anvil_qualification_revoked', after: { qualificationId: q.id, receiptId: e.receipt_id, eventId: e.event_id, sequence: e.sequence, templateVersionHash: hash, reason: e.reason, matchedReceipt: !!original } });
      const projects = await tx.project.findMany({ where: { clientId: c.clientId, templateId: t.id }, select: { id: true } });
      for (const p of projects) await audit({ entityType: 'Project', entityId: p.id, action: 'project.anvil_qualification_revoked', after: { templateId: t.id, version: t.version, receiptId: e.receipt_id, eventId: e.event_id } });
    } else {
      await audit({ entityType: 'Template', entityId: t.id, action: 'template.anvil_revocation_repeated', after: { receiptId: e.receipt_id, eventId: e.event_id, sequence: e.sequence } });
    }
    return ack(outcome);
  }
};

/** Praxis-owned authoring part schema (four confirmations, point 2), published with the contracts. */
const AUTHORING_SCHEMA = {
  $id: 'praxis.anvil.authoring.v1',
  type: 'object',
  required: ['profile'],
  additionalProperties: false,
  properties: {
    profile: { description: 'A praxis.template_profile.v1 form (S1-S8, storage "sections"). Its field names are Praxis’s.', type: 'object' },
    template: {
      description: 'Only for a workflow new to Praxis: domainName, primaryWork, verificationCriteria, humanGate, skills, defaultTptMinutes, taskModes?, coverageDimensions?, edgeCaseCatalog?.',
      type: 'object',
    },
    examples: { description: 'Synthetic worked examples: [{name, output}] where output is an authored record of this form. Reference answers stay private.', type: 'array', maxItems: 20 },
  },
} as const;
