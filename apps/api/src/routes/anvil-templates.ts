import { checkTemplateSpec, FIELD_TYPES, GOLDEN_PACK_SCHEMA_VERSION, PROFILE_SCHEMA_VERSION, profileById, TEMPLATE_SPEC_SCHEMA, TemplateSpec, templateVersionContent, type TemplateSpecCheck } from '@praxis/shared';
import type { Prisma, Template } from '@prisma/client';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ApiClientActor } from '../auth/actor';
import type { Db, Tx } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import { runStaffOrServiceCommand } from '../platform/command';
import { packProfileId, storePack } from '../templates/golden-pack-store';
import { loadUploadedProfiles, profileIdTaken } from '../templates/uploaded-profiles';

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
async function staffingAdvice(db: Db | Tx, clientId: string, spec: TemplateSpec) {
  const out: { code: string; message: string; counts?: Record<string, number> }[] = [];
  const count = async (skills: string[]) => (skills.length ? db.candidate.count({ where: { clientId, OR: [{ skills: { hasSome: skills } }, { specialties: { hasSome: skills } }] } }) : 0);
  const authors = await count(spec.skills.authoring.mandatory);
  const reviewers = await count(spec.skills.reviewing.mandatory);
  const validators = await db.user.count({ where: { clientId, roles: { has: 'REVIEWER' }, status: 'ACTIVE' } });
  const counts = { eligibleAuthors: authors, eligibleReviewerCandidates: reviewers, activeValidators: validators };
  if (authors < SUPPLY_MIN) out.push({ code: 'PR_RECRUITMENT_NEEDED', message: `Praxis has ${authors} candidate(s) with the authoring skills; recruitment is needed before staffing.`, counts });
  if (reviewers < SUPPLY_MIN && validators < 1) out.push({ code: 'PR_SUPPLY_INSUFFICIENT', message: 'Praxis has too few reviewers with the reviewing skills; reviewer recruitment is needed.', counts });
  if (spec.skills.authoring.certifications.length || spec.skills.reviewing.certifications.length) out.push({ code: 'PR_CERTIFICATION_NEEDED', message: 'The proposal asks for certifications; Praxis certifies SMEs before staffing.', counts });
  if (!out.length) out.push({ code: 'PR_SUPPLY_OK', message: 'Praxis has people with these skills; staffing is decided per project.', counts });
  return out;
}

async function check(db: Db | Tx, clientId: string, body: unknown): Promise<TemplateSpecCheck & { spec: TemplateSpec | null }> {
  await loadUploadedProfiles(db as Db);
  const parsed = TemplateSpec.safeParse(body);
  const id = parsed.success ? packProfileId(parsed.data.pack) : null;
  const taken = id ? await profileIdTaken(db as Db, id) : false;
  const r = checkTemplateSpec(body, () => taken);
  if (parsed.success && r.pack?.profile) {
    // A new workflow needs its template in the pack; an existing one gets a new version.
    const exists = await db.template.count({ where: { clientId, workflowName: { equals: r.pack.profile.catalogWorkflowName, mode: 'insensitive' } } });
    const hasTemplate = !!(parsed.data.pack as { template?: unknown }).template;
    if (!exists && !hasTemplate) r.errors.push({ code: 'TP_TEMPLATE_MISSING', owner: 'anvil', file: 'template-spec.json', pointer: '/pack/template', message: `The workflow "${r.pack.profile.catalogWorkflowName}" is new to Praxis and the proposal has no template block.`, fix: 'Add pack.template (domain, primary work, verification criteria, human gate, TPT, coverage).' });
    r.valid = r.errors.length === 0;
  }
  if (parsed.success) r.praxisRequirements = await staffingAdvice(db, clientId, parsed.data);
  return { ...r, spec: parsed.success ? parsed.data : null };
}

/** The hash both sides accept for a template version: workflow, version, form, execution part and skills. */
export function templateVersionHash(t: Pick<Template, 'workflowName' | 'version' | 'profileId' | 'anvilSpec'>) {
  const spec = (t.anvilSpec ?? {}) as { execution?: unknown; skills?: unknown };
  return sha256(templateVersionContent({ workflowName: t.workflowName, version: t.version, profile: t.profileId ? (profileById(t.profileId) ?? null) : null, execution: spec.execution ?? null, skills: spec.skills ?? null }));
}

/** Anvil readiness of one template version: its hash and the latest qualification for that hash. */
export async function anvilReadiness(db: Db | Tx, t: Template) {
  const versionHash = templateVersionHash(t);
  const q = await db.templateQualification.findFirst({ where: { templateId: t.id, templateVersionHash: versionHash }, orderBy: { createdAt: 'desc' } });
  const qualification = !q ? 'none' : q.status === 'QUALIFIED' ? 'qualified' : 'revoked';
  return { versionHash, proposedByAnvil: !!t.anvilSpec, qualification, receiptId: q?.receiptId ?? null, qualifiedAt: q?.createdAt.toISOString() ?? null, anvilReady: t.status === 'PUBLISHED' && qualification === 'qualified' };
}

const proposalStatus = (t: Template | null) => (!t ? 'missing' : t.status === 'DRAFT' ? 'draft_created' : t.status === 'PUBLISHED' ? 'published' : 'retired');

export const anvilTemplateRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const client = (req: { apiClient: ApiClientActor | null }) => {
    if (!req.apiClient) throw new AppError(401, 'UNAUTHENTICATED', 'An Anvil API key is required.');
    return req.apiClient;
  };

  app.get('/integrations/anvil/templates/contracts', { config: { access: ANVIL }, schema: { tags: ['anvil'] } }, async (req) =>
    envelope(req.id, {
      template_spec_schema_versions: [TEMPLATE_SPEC_SCHEMA],
      pack_schema_version: GOLDEN_PACK_SCHEMA_VERSION,
      profile_schema_version: PROFILE_SCHEMA_VERSION,
      field_types: FIELD_TYPES,
      limits: { maximum_upload_bytes: MAX_BYTES, maximum_examples: 20 },
      // Anvil's capability catalogue is open question 3; Praxis checks shapes, not catalogue membership, until then.
      capability_catalogue_versions: [],
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
      if (!r.valid || !r.spec) {
        return { status: 422, body: envelope(req.id, { schema_version: 'praxis.template-validation.v1', valid: false, status: 'template_invalid', errors: r.errors, error_count: r.errors.length, praxis_requirements: r.praxisRequirements, review_gates: [], paid_calls: false }) };
      }
      const spec = r.spec;
      const anvilSpec = { requirement: spec.requirement, execution: spec.execution, skills: spec.skills } as unknown as Prisma.InputJsonValue;
      const stored = await storePack(tx, { clientId: c.clientId, uploaderId: c.apiClientId, body: spec.pack, audit, anvilSpec, newVersionOfExisting: true, from: 'anvil_proposal' });
      if (!stored.createdTemplateId) throw new AppError(500, 'NO_DRAFT', 'The proposal was stored but no draft template version was created.');
      // The template's skills drive the generated JDs: the authoring skills from Anvil (reviewer JD adds experience).
      const draft = await tx.template.update({ where: { id: stored.createdTemplateId }, data: { skills: [...new Set(spec.skills.authoring.mandatory)] } });
      const proposal = await tx.templateProposal.create({
        data: { clientId: c.clientId, apiClientId: c.apiClientId, requirementId: spec.requirement.id, profileId: stored.row.profileId, templateId: draft.id, spec: req.body as Prisma.InputJsonValue, specSha256: sha256(stableStringify(req.body)) },
      });
      await audit({ entityType: 'TemplateProposal', entityId: proposal.id, action: 'template_proposal.received', after: { requirementId: proposal.requirementId, profileId: proposal.profileId, templateId: draft.id, version: draft.version, specSha256: proposal.specSha256 } });
      return { status: 201, body: envelope(req.id, { proposal_id: proposal.id, status: 'draft_created', template_id: draft.id, template_version: draft.version, workflow: draft.workflowName, profile_id: proposal.profileId, praxis_requirements: r.praxisRequirements, review_gates: [{ code: 'REVIEW_PRAXIS_PUBLISH', message: 'A Praxis Admin completes and publishes the draft; nothing goes live from the API.' }] }) };
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
    return envelope(req.id, { proposal_id: p.id, requirement_id: p.requirementId, status: proposalStatus(t), template_id: p.templateId, template_version: t?.version ?? null, profile_id: p.profileId, template_version_hash: t?.status === 'PUBLISHED' ? ready!.versionHash : null, qualification: ready?.qualification ?? 'none' });
  });

  /** Console: whether a template version is Anvil-ready for benchmarks (published and qualified for its exact hash). */
  app.get('/templates/:id/anvil', { config: { access: ['ADMIN', 'PM'] }, schema: { tags: ['templates'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const t = await db.template.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId } });
    if (!t) throw notFound('Template not found');
    const spec = (t.anvilSpec ?? null) as { requirement?: { id?: string; channel?: string } } | null;
    return { ...(await anvilReadiness(db, t)), requirementId: spec?.requirement?.id ?? null, channel: spec?.requirement?.channel ?? null };
  });

  app.post(
    '/integrations/anvil/templates/qualifications',
    {
      config: { access: ANVIL },
      schema: {
        tags: ['anvil'],
        body: z.object({ template_id: z.string().uuid(), template_version_hash: z.string().regex(/^[0-9a-f]{64}$/), status: z.enum(['QUALIFIED', 'REVOKED']), receipt_id: z.string().trim().min(1).max(200), receipt: z.record(z.string(), z.unknown()) }).strict(),
      },
    },
    async (req, reply) => {
      const c = client(req);
      await asContract(() => runStaffOrServiceCommand(db, req, reply, async ({ tx, audit }) => {
        const t = await tx.template.findFirst({ where: { id: req.body.template_id, clientId: c.clientId } });
        if (!t) throw notFound('Template not found');
        if (t.status !== 'PUBLISHED' && req.body.status === 'QUALIFIED') throw new AppError(409, 'TEMPLATE_NOT_PUBLISHED', 'Only a published template version can be qualified.');
        const hash = templateVersionHash(t);
        if (hash !== req.body.template_version_hash) throw new AppError(409, 'TEMPLATE_VERSION_MISMATCH', 'The receipt is for different template content than this version holds.', { expected: hash });
        const q = await tx.templateQualification.create({ data: { clientId: c.clientId, templateId: t.id, templateVersionHash: hash, status: req.body.status, receiptId: req.body.receipt_id, receipt: req.body.receipt as Prisma.InputJsonValue, apiClientId: c.apiClientId } });
        await audit({ entityType: 'Template', entityId: t.id, action: req.body.status === 'QUALIFIED' ? 'template.anvil_qualified' : 'template.anvil_qualification_revoked', after: { qualificationId: q.id, receiptId: q.receiptId, templateVersionHash: hash } });
        return { status: 201, body: envelope(req.id, { qualification_id: q.id, template_id: t.id, template_version_hash: hash, status: q.status, recorded_at: q.createdAt.toISOString() }) };
      }));
      return reply;
    },
  );
};
