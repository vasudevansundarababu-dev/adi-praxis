import { aiFailureKind, aiUnavailableMessage } from '../lib/ai-errors';
import { randomUUID } from 'node:crypto';
import '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CandidateRule, LOCATOR_GRANULARITY, PolicyRuleBody, ProjectRuleSetContent, REVERSE_RELATION, RuleAnnotationInput, TaskChangeInput, annotationFlags } from '@praxis/shared';
import type { MalwareScanner, ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError, badRequest, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { POLICY_ACCESS, isAdmin, policyProject, policyTask, requireAdmin } from '../policy/access';
import { MAX_POLICY_BYTES, readPolicyDocument } from '../policy/document-reader';
import { caseSelectorOf } from '../tasks/task-service';
import { addDocumentVersion, loadVersionText } from '../policy/documents';
import { startBatch, spentUsd, type Adapters } from '../policy/extraction/service';
import { ensureProfiles } from '../policy/profiles';
import { previewRuleSet, publishRuleSet } from '../policy/rule-sets';
import { RuleAssistantUnavailableError, type PolicyRuleAssistant, type SuggestRule } from '../policy/rule-assistant';
import { contentHash, createRuleFromCandidate, currentVersions, definitionProblems, editRule, evidenceProblems, inheritedEffectiveFrom, markExcluded, markReviewed, restoreExcluded, reviewProblems, ruleVersionFull, setApplied, type CitationEdit } from '../policy/rules';
import { addChange, effectivePolicy, removeChange, sidecar, snapshotTask } from '../policy/task-policy';
import { annotationState, editorRole, revisionDto, revisionsForRules, type RevisionRow } from '../policy/annotations';
import { ANNOTATION_ACTIONS } from '../policy/annotate-job';
import { ENRICHMENT_ACTIONS, enrichmentCalls, enrichmentInputs } from '../policy/enrich';
import { approvalRoute, assertApprovable } from '../policy/approval-route';
import { nextAction, ruleQueueFlags } from '../policy/review-queue';
import { estimateUsd, modelPrice } from '../policy/ai-pricing';
import { policyAiModel } from '../policy/rule-assistant';
import { conditionFacts, conditionLabel, jurisdictionProblem } from '@praxis/shared';
import { conditionCatalog } from '../policy/fact-catalog';

/** D-089: a requested job no worker has taken within this long is reported as "no worker", never a silent queue. */
export const WORKER_PICKUP_MS = 60_000;
const NO_WORKER_MESSAGE = 'No worker is running, so this job has not started. Ask whoever runs this deployment to start the policy worker; the job starts as soon as it runs.';
import { POLICY_AI_ACTIONS } from '../policy/ai-cap';

const ProjectParams = z.object({ projectId: z.string().uuid() });
/** Per signed-in session rather than per IP, so colleagues behind one office address do not share a limit. */
const perSession = (max: number) => ({ max, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => req.cookies?.praxis_session ?? req.ip });
const TaskParams = z.object({ taskId: z.string().uuid() });
/** D-090: a rule's library jurisdiction must be a real ISO 3166 code, not only look like one ("US-A" is refused). */
function assertRuleJurisdiction(body: { library?: { jurisdiction?: string } | undefined }) {
  const j = body.library?.jurisdiction;
  const problem = j === undefined ? null : jurisdictionProblem(j);
  if (problem) throw new AppError(422, 'JURISDICTION_NOT_ISO', problem);
}
const DocMeta = z.object({
  title: z.string().trim().min(1).max(300),
  category: z.string().trim().max(100).nullish(),
  language: z.string().trim().max(20).nullish(),
  jurisdiction: z.string().trim().max(100).nullish(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
const ManualText = DocMeta.extend({ documentId: z.string().uuid().nullish(), text: z.string().min(1).max(500_000), granularity: z.enum(LOCATOR_GRANULARITY).default('line'), format: z.enum(['txt', 'md']).default('txt') });
const ExtractBody = z.object({ documentVersionIds: z.array(z.string().uuid()).min(1).max(20), profileId: z.string().max(100).nullish(), parentBatchId: z.string().uuid().nullish() });
const CitationIn = z.object({ documentVersionId: z.string().uuid(), fieldPath: z.string().min(1).max(100), role: z.enum(['supports', 'qualifies', 'exception', 'conflict']), quote: z.string().min(1).max(4000), section: z.string().max(200).nullish() });
const ManualRule = z.object({ documentVersionId: z.string().uuid(), ruleKey: z.string().trim().max(60).nullish(), body: PolicyRuleBody, citations: z.array(CitationIn.omit({ documentVersionId: true })).max(50) });
const EditBody = z.object({ expectedContentHash: z.string().length(64), body: PolicyRuleBody, citations: z.array(CitationIn).max(50).optional(), annotationBasedOnRevisionId: z.string().uuid().nullish() });
const AnnotateBody = z.object({ documentId: z.string().uuid() });
const AnnotationEdit = z.object({ expectedContentHash: z.string().length(64), annotation: RuleAnnotationInput, basedOnRevisionId: z.string().uuid().nullish() });
/** `required` is deprecated (15 Nov 2026): accepted from older clients and ignored; the annotation's marking replaced it. */
const Decision = z.object({ expectedContentHash: z.string().length(64), required: z.boolean().optional() });
const ExcludeBody = z.object({ expectedContentHash: z.string().length(64), reason: z.string().trim().min(1).max(1000) });
const PublishBody = z.object({ expectedLatestVersion: z.number().int().positive().nullable() });
const ProfileSetting = z.object({ profileId: z.string().max(100) });
const ProfilePatch = z.object({ enabled: z.boolean() });
const ApplyBody = z.object({ applied: z.boolean(), expectedContentHash: z.string().length(64), acceptUnverifiedEvidence: z.boolean().optional(), required: z.boolean().optional() });
const DefineBody = z.object({ expectedContentHash: z.string().length(64) });
const SuggestBody = z.object({ documentId: z.string().uuid(), prompt: z.string().trim().min(1).max(4000) });

function versionDto(v: { id: string; version: number; sha256: string; fileName: string; format: string; mediaType: string; sizeBytes: number; pageCount: number; pageCountMethod: string; locatorGranularity: string; origin: string; createdAt: Date }) {
  return { id: v.id, version: v.version, sha256: v.sha256, fileName: v.fileName, format: v.format, mediaType: v.mediaType, sizeBytes: v.sizeBytes, pageCount: v.pageCount, pageCountMethod: v.pageCountMethod, locatorGranularity: v.locatorGranularity, origin: v.origin, createdAt: v.createdAt };
}

function scopeText(b: PolicyRuleBody) {
  const a = b.applicability;
  if (a.universal) return 'everywhere in the project';
  return [a.actors.join(', '), a.actions.join(', '), a.entities.join(', '), a.channels.join(', '), a.locales.join(', '), a.jurisdictions.join(', '), a.conditionText ?? ''].filter(Boolean).join('; ');
}

type Current = Awaited<ReturnType<typeof currentVersions>>[number];

/** Links pointing at each rule, computed when read (linking never edits the other rule). */
function reverseLinks(items: Current[]) {
  const out = new Map<string, Array<{ ruleKey: string; relation: string }>>();
  for (const i of items) {
    for (const l of PolicyRuleBody.parse(i.version.body).annotation?.links ?? []) {
      const list = out.get(l.ruleKey) ?? [];
      list.push({ ruleKey: i.rule.ruleKey, relation: REVERSE_RELATION[l.relation] });
      out.set(l.ruleKey, list);
    }
  }
  return out;
}

/** The annotation part of a rule row: current annotation, who set it, a pending AI suggestion, flags, reverse links. */
function annotationDto(b: PolicyRuleBody, revisions: RevisionRow[], known: Set<string>, linkedFrom: Array<{ ruleKey: string; relation: string }>) {
  const { current, pending } = annotationState(b, revisions);
  return {
    annotation: b.annotation ?? null,
    annotationSource: current ? { source: current.source, editedRole: current.editedRole, editedById: current.editedById, at: current.createdAt, model: current.model } : null,
    pendingAiSuggestion: pending ? revisionDto(pending) : null,
    flags: annotationFlags(b.annotation, { known }),
    linkedFrom,
  };
}

function ruleDto(r: Current, ann: ReturnType<typeof annotationDto>) {
  const b = PolicyRuleBody.parse(r.version.body);
  const evidence = r.version.citations.find((c) => c.fieldPath === 'requirement') ?? r.version.citations[0];
  return {
    ruleId: r.rule.id,
    ruleKey: r.rule.ruleKey,
    required: r.rule.required,
    versionId: r.version.id,
    version: r.version.version,
    state: r.version.state,
    contentHash: r.version.contentHash,
    origin: r.version.origin,
    title: b.title,
    requirementType: b.requirementType,
    uncertainty: b.uncertainty,
    requirement: b.requirement,
    applied: r.version.state === 'REVIEWED',
    documentIds: [...new Set(r.version.citations.map((c) => c.documentVersion.documentId))],
    evidence: evidence ? { quote: evidence.quote.slice(0, 600), resolution: evidence.resolution, document: evidence.documentVersion.document.title, documentVersion: evidence.documentVersion.version, locator: evidence.locator } : null,
    definitionProblems: definitionProblems(r.version.body, { inheritedFrom: inheritedEffectiveFrom(r.version.citations) }),
    evidenceProblems: evidenceProblems(r.version),
    sources: r.version.citations.map((c) => ({ document: c.documentVersion.document.title, documentVersion: c.documentVersion.version, locator: c.locator, resolution: c.resolution })),
    effective: { from: b.effective.from, to: b.effective.to },
    ...ann,
  };
}

/**
 * Policy Rules (docs/prd/PRD-POLICY-RULES.md, docs/architecture/ARCH-POLICY-RULES.md). Owning PM and Admin only;
 * every change goes through runCommand (idempotency, audit, outbox in one transaction).
 */
export const policyRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; storage: ObjectStorage; scanner: MalwareScanner; adapters: Adapters; assistant: PolicyRuleAssistant }> = async (app, { db, config, storage, scanner, adapters, assistant }) => {
  const policy = config.policy;
  const loadText = (v: { textStorageKey: string }) => loadVersionText(storage, v);

  // ───────── Documents (slice 1) ─────────
  app.get('/projects/:projectId/policy/documents', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const docs = await db.policyDocument.findMany({ where: { projectId: p.id, archivedAt: null }, orderBy: { createdAt: 'asc' }, include: { versions: { orderBy: { version: 'desc' } } } });
    return {
      maxPages: policy.maxPages,
      items: docs.map((d) => ({ id: d.id, title: d.title, libraryKind: d.libraryKind, captureSourceUrl: d.captureSourceUrl, captureDownloadedOn: d.captureDownloadedOn?.toISOString().slice(0, 10) ?? null, category: d.category, language: d.language, jurisdiction: d.jurisdiction, effectiveFrom: d.effectiveFrom, effectiveTo: d.effectiveTo, latestVersion: d.latestVersion, versions: d.versions.map(versionDto) })),
    };
  });

  app.post('/projects/:projectId/policy/documents', { config: { access: POLICY_ACCESS, rateLimit: perSession(30) }, schema: { tags: ['policy'], params: ProjectParams } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_POLICY_BYTES + 1, files: 1, fields: 10 } });
    if (!file) throw badRequest('Attach a file');
    const buf = await file.toBuffer();
    if (file.file.truncated || buf.length > MAX_POLICY_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
    const fields = Object.fromEntries(Object.entries(file.fields).map(([k, v]) => [k, (v as { value?: string } | undefined)?.value]));
    const meta = DocMeta.extend({ documentId: z.string().uuid().nullish() }).safeParse({ ...fields, title: fields.title || file.filename });
    if (!meta.success) throw badRequest('Check the document details: a title is required and dates use YYYY-MM-DD.');
    const read = await readPolicyDocument(buf, file.filename, policy.maxPages);
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const r = await addDocumentVersion(tx, { storage, scanner, maxPages: policy.maxPages }, { clientId: actor.clientId, projectId: p.id, actorId: actor.userId, documentId: meta.data.documentId, meta: meta.data, fileName: file.filename, buf, origin: 'UPLOAD', read }, audit);
      if (!r.created) await audit({ entityType: 'PolicyDocumentVersion', entityId: r.version.id, action: 'policy.document_version_reused', after: { sha256: r.version.sha256 } });
      return { status: r.created ? 201 : 200, body: { documentId: r.document.id, version: versionDto(r.version), created: r.created } };
    });
    return reply;
  });

  app.post('/projects/:projectId/policy/documents/text', { config: { access: POLICY_ACCESS, rateLimit: perSession(30) }, schema: { tags: ['policy'], params: ProjectParams, body: ManualText } }, async (req, reply) => {
    const b = req.body;
    const buf = Buffer.from(b.text, 'utf8');
    if (buf.length > MAX_POLICY_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The text is larger than 10 MB.');
    const fileName = `${b.title.replace(/[^\w.\- ]+/g, '_').slice(0, 80)}.${b.format}`;
    const read = await readPolicyDocument(buf, fileName, policy.maxPages);
    read.locatorGranularity = b.granularity === 'page' ? 'line' : b.granularity;
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const r = await addDocumentVersion(tx, { storage, scanner, maxPages: policy.maxPages }, { clientId: actor.clientId, projectId: p.id, actorId: actor.userId, documentId: b.documentId, meta: b, fileName, buf, origin: 'MANUAL_TEXT', read }, audit);
      return { status: r.created ? 201 : 200, body: { documentId: r.document.id, version: versionDto(r.version), created: r.created } };
    });
    return reply;
  });

  app.get('/projects/:projectId/policy/document-versions/:versionId/text', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ versionId: z.string().uuid() }) } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const v = await db.policyDocumentVersion.findFirst({ where: { id: req.params.versionId, projectId: p.id } });
    if (!v) throw notFound('Document version not found');
    return { ...versionDto(v), ...(await loadText(v)) };
  });

  app.get('/projects/:projectId/policy/document-versions/:versionId/file', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ versionId: z.string().uuid() }) } }, async (req, reply) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const v = await db.policyDocumentVersion.findFirst({ where: { id: req.params.versionId, projectId: p.id } });
    if (!v) throw notFound('Document version not found');
    return reply.header('content-type', v.mediaType).header('content-disposition', `attachment; filename="${v.fileName.replace(/"/g, '')}"`).header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff').send(await storage.get(v.storageKey));
  });

  // ───────── Extraction (slices 2–3) ─────────
  app.get('/projects/:projectId/policy/extraction', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const actor = req.actor!;
    const p = await policyProject(db, actor, req.params.projectId);
    const profiles = await ensureProfiles(db, actor.clientId);
    const setting = await db.projectExtractionSetting.findUnique({ where: { projectId: p.id } });
    const resolvedId = setting?.profileId ?? profiles.find((x) => x.isDefault)?.id ?? null;
    const resolved = profiles.find((x) => x.id === resolvedId) ?? null;
    const problems = resolved ? [...(resolved.enabled ? [] : ['This extraction profile is disabled.']), ...adapters[resolved.provider as keyof Adapters].availability()] : ['No extraction profile is configured.'];
    const batches = await db.extractionBatch.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' }, take: 20, include: { jobs: { include: { documentVersion: { include: { document: true } } } } } });
    // D-089: an extraction request still in the outbox after a minute means no worker is taking jobs.
    const queuedJobs = await db.extractionJob.findMany({ where: { status: 'QUEUED', batch: { projectId: p.id } }, select: { id: true } });
    const waiting = queuedJobs.length ? await db.outboxEvent.findFirst({ where: { name: 'policy.extraction_requested', dispatchedAt: null, createdAt: { lt: new Date(Date.now() - WORKER_PICKUP_MS) }, aggregateId: { in: queuedJobs.map((j) => j.id) } }, select: { id: true } }) : null;
    const budget = resolved ? { provider: resolved.provider, ceilingUsd: policy.budgets[resolved.provider as keyof typeof policy.budgets], spentUsd: await spentUsd(db, resolved.provider as 'llamaextract' | 'google'), usdPerPage: policy.prices[resolved.provider as keyof typeof policy.prices] } : null;
    return {
      profile: resolved && { id: resolved.id, label: resolved.label, provider: resolved.provider, revision: resolved.revision, source: setting ? 'project' : 'deployment' },
      available: problems.length === 0,
      problems,
      workerMissing: !!waiting,
      ...(waiting ? { workerMessage: NO_WORKER_MESSAGE } : {}),
      budget: isAdmin(actor) ? budget : budget && { provider: budget.provider, exhausted: budget.ceilingUsd !== null && budget.spentUsd >= budget.ceilingUsd },
      profiles: isAdmin(actor) ? profiles.map((x) => ({ id: x.id, label: x.label, provider: x.provider, enabled: x.enabled, isDefault: x.isDefault, revision: x.revision, problems: adapters[x.provider as keyof Adapters].availability() })) : undefined,
      batches: batches.map((b) => ({
        id: b.id,
        status: b.status,
        profileId: b.profileId,
        profileRevision: b.profileRevision,
        selectionSource: b.selectionSource,
        parentBatchId: b.parentBatchId,
        createdAt: b.createdAt,
        finishedAt: b.finishedAt,
        jobs: b.jobs.map((j) => ({ id: j.id, status: j.status, provider: j.provider, documentVersionId: j.documentVersionId, document: j.documentVersion.document.title, documentVersion: j.documentVersion.version, candidateCount: j.candidateCount, error: j.error, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt, submitted: j.providerOperationId !== null, ...(isAdmin(actor) ? { estimatedUsd: Number(j.estimatedUsd), actualUsd: j.actualUsd === null ? null : Number(j.actualUsd) } : {}) })),
      })),
    };
  });

  app.post('/projects/:projectId/policy/extraction', { config: { access: POLICY_ACCESS, rateLimit: perSession(10) }, schema: { tags: ['policy'], params: ProjectParams, body: ExtractBody } }, async (req, reply) => {
    await runCommand(db, req, reply, async (ctx) => {
      const p = await policyProject(ctx.tx, ctx.actor, req.params.projectId);
      if (req.body.profileId) requireAdmin(ctx.actor);
      const r = await startBatch(ctx, { adapters, policy }, { clientId: ctx.actor.clientId, projectId: p.id, actorId: ctx.actor.userId, documentVersionIds: req.body.documentVersionIds, override: req.body.profileId ?? null, parentBatchId: req.body.parentBatchId });
      if (!r.created) await ctx.audit({ entityType: 'ExtractionBatch', entityId: r.batch.id, action: 'policy.extraction_reused', after: {} });
      return { status: r.created ? 202 : 200, body: { batchId: r.batch.id, status: r.batch.status, created: r.created, jobs: r.batch.jobs.map((j) => ({ id: j.id, status: j.status, documentVersionId: j.documentVersionId })) } };
    });
    return reply;
  });

  app.put('/projects/:projectId/policy/extraction/profile', { config: { access: ['ADMIN'] }, schema: { tags: ['policy'], params: ProjectParams, body: ProfileSetting } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const profiles = await ensureProfiles(tx, actor.clientId);
      if (!profiles.some((x) => x.id === req.body.profileId)) throw new AppError(400, 'UNKNOWN_PROFILE', 'Unknown extraction profile.');
      const before = await tx.projectExtractionSetting.findUnique({ where: { projectId: p.id } });
      await tx.projectExtractionSetting.upsert({ where: { projectId: p.id }, create: { projectId: p.id, clientId: actor.clientId, profileId: req.body.profileId, updatedById: actor.userId }, update: { profileId: req.body.profileId, updatedById: actor.userId } });
      await audit({ entityType: 'Project', entityId: p.id, action: 'policy.extraction_profile_set', before: { profileId: before?.profileId ?? null }, after: { profileId: req.body.profileId } });
      return { status: 200, body: { profileId: req.body.profileId } };
    });
    return reply;
  });

  app.patch('/policy/extraction-profiles/:profileId', { config: { access: ['ADMIN'] }, schema: { tags: ['policy'], params: z.object({ profileId: z.string().max(100) }), body: ProfilePatch } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      await ensureProfiles(tx, actor.clientId);
      const prof = await tx.extractionProfile.findFirst({ where: { id: req.params.profileId, clientId: actor.clientId } });
      if (!prof) throw notFound('Extraction profile not found');
      const out = await tx.extractionProfile.update({ where: { clientId_id: { clientId: actor.clientId, id: prof.id } }, data: { enabled: req.body.enabled, revision: { increment: 1 } } });
      await audit({ entityType: 'ExtractionProfile', entityId: prof.id, action: 'policy.extraction_profile_changed', before: { enabled: prof.enabled, revision: prof.revision }, after: { enabled: out.enabled, revision: out.revision } });
      return { status: 200, body: { id: out.id, enabled: out.enabled, revision: out.revision } };
    });
    return reply;
  });

  // ───────── Rules (slice 4) ─────────
  app.get('/projects/:projectId/policy/rules', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const items = await currentVersions(db, req.actor!.clientId, p.id);
    const revisions = await revisionsForRules(db, req.actor!.clientId, items.map((i) => i.rule.id));
    const byRule = new Map<string, RevisionRow[]>();
    for (const r of revisions) byRule.set(r.ruleId, [...(byRule.get(r.ruleId) ?? []), r]);
    const known = new Set(items.map((i) => i.rule.ruleKey));
    const reverse = reverseLinks(items);
    return { items: items.map((i) => ruleDto(i, annotationDto(PolicyRuleBody.parse(i.version.body), byRule.get(i.rule.id) ?? [], known, reverse.get(i.rule.ruleKey) ?? []))) };
  });

  async function ruleDetail(projectId: string, clientId: string, versionId: string) {
    const v = await ruleVersionFull(db, clientId, versionId);
    if (v.rule.projectId !== projectId) throw notFound('Rule version not found');
    const history = await db.policyRuleVersion.findMany({ where: { ruleId: v.ruleId }, orderBy: { version: 'desc' }, select: { id: true, version: true, state: true, origin: true, reviewedAt: true, createdAt: true } });
    const revisions = await revisionsForRules(db, clientId, [v.ruleId]);
    const all = await currentVersions(db, clientId, projectId);
    const ann = annotationDto(PolicyRuleBody.parse(v.body), revisions, new Set(all.map((i) => i.rule.ruleKey)), reverseLinks(all).get(v.rule.ruleKey) ?? []);
    const template = await db.project.findUnique({ where: { id: projectId }, select: { template: { select: { caseSelector: true } } } });
    // D-091/D-092: the project's approval route, and for the current version its queue flags and next action.
    const route = await approvalRoute(db, projectId);
    const current = all.find((i) => i.version.id === v.id);
    const queueFlags = route === 'review_queue' && current && v.state !== 'REVIEWED' ? await ruleQueueFlags(db, clientId, projectId, v.ruleId) : [];
    // D-094: what the library (C1) uses, for the KYC rule page: the condition in plain words and its facts, and where the
    // in-force date comes from (the rule's own date wins; otherwise its document's, as in the queue and the export).
    const parsed = PolicyRuleBody.parse(v.body);
    const inherited = inheritedEffectiveFrom(v.citations);
    const library = route === 'review_queue'
      ? {
          conditionSet: parsed.condition !== undefined,
          conditionText: parsed.condition === undefined ? null : conditionLabel(parsed.condition, await conditionCatalog(db, projectId)),
          conditionFacts: parsed.condition ? conditionFacts(parsed.condition) : [],
          inForce: parsed.effective.from ? { from: parsed.effective.from, source: 'rule' as const } : inherited ? { from: inherited, source: 'document' as const } : null,
        }
      : null;
    return {
      library,
      ...ann,
      approvalRoute: route,
      queueFlags,
      nextAction: current && v.state !== 'REVIEWED' && route === 'review_queue' ? nextAction(current, queueFlags) : null,
      annotationHistory: [...revisions].reverse().map(revisionDto),
      applicationTypeOptions: caseSelectorOf(template?.template.caseSelector)?.values ?? [],
      projectRuleKeys: all.map((i) => i.rule.ruleKey),
      ruleId: v.ruleId,
      ruleKey: v.rule.ruleKey,
      required: v.rule.required,
      versionId: v.id,
      version: v.version,
      latest: history[0]?.id === v.id,
      state: v.state,
      applied: v.state === 'REVIEWED',
      contentHash: v.contentHash,
      body: v.body,
      excludeReason: v.excludeReason,
      reviewedById: v.reviewedById,
      reviewedAt: v.reviewedAt,
      origin: v.origin,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      problems: v.state === 'REVIEWED' || v.state === 'EXCLUDED' ? [] : reviewProblems(v),
      definitionProblems: definitionProblems(v.body, { inheritedFrom: inheritedEffectiveFrom(v.citations) }),
      evidenceProblems: evidenceProblems(v),
      citations: v.citations.map((c) => ({ id: c.id, fieldPath: c.fieldPath, role: c.role, quote: c.quote, locator: c.locator, resolution: c.resolution, documentVersionId: c.documentVersionId, documentId: c.documentVersion.documentId, document: c.documentVersion.document.title, documentVersion: c.documentVersion.version, sha256: c.documentVersion.sha256, format: c.documentVersion.format })),
      history,
    };
  }

  app.get('/projects/:projectId/policy/rule-versions/:versionId', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ versionId: z.string().uuid() }) } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    return ruleDetail(p.id, req.actor!.clientId, req.params.versionId);
  });

  /** The rule page (PR-M07): the rule's current version with every field, its evidence and history. */
  app.get('/projects/:projectId/policy/rules/:ruleId', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ ruleId: z.string().uuid() }) } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const v = await db.policyRuleVersion.findFirst({ where: { ruleId: req.params.ruleId, clientId: req.actor!.clientId, rule: { projectId: p.id } }, orderBy: { version: 'desc' }, select: { id: true } });
    if (!v) throw notFound('Rule not found');
    return ruleDetail(p.id, req.actor!.clientId, v.id);
  });

  /** Apply to project (PR-M04): a PM or Admin ticking the box is the review. Never done by AI. */
  app.put('/projects/:projectId/policy/rules/:ruleId/applied', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ ruleId: z.string().uuid() }), body: ApplyBody } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      // D-091: in a policy-library project a flagged rule is never ticked Reviewed (the review queue's check).
      if (req.body.applied) {
        const rule = await tx.policyRule.findFirst({ where: { id: req.params.ruleId, clientId: actor.clientId, projectId: p.id }, select: { ruleKey: true } });
        if (rule) await assertApprovable(tx, { clientId: actor.clientId, projectId: p.id, ruleId: req.params.ruleId, ruleKey: rule.ruleKey });
      }
      const r = await setApplied(tx, { clientId: actor.clientId, projectId: p.id, ruleId: req.params.ruleId, actorId: actor.userId, roles: actor.roles, applied: req.body.applied, expectedContentHash: req.body.expectedContentHash, acceptUnverifiedEvidence: req.body.acceptUnverifiedEvidence, required: req.body.required }, audit);
      if (!r.changed) await audit({ entityType: 'PolicyRuleVersion', entityId: r.version.id, action: 'policy.rule_apply_unchanged', after: { applied: req.body.applied } });
      return { status: 200, body: { applied: r.version.state === 'REVIEWED', changed: r.changed, versionId: r.version.id, version: r.version.version, state: r.version.state, contentHash: r.version.contentHash, warnings: r.warnings } };
    });
    return reply;
  });

  async function checkAiCap(clientId: string) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const used = await db.auditEvent.count({ where: { clientId, action: { in: POLICY_AI_ACTIONS }, createdAt: { gte: since } } });
    if (used >= config.POLICY_AI_DAILY_CALL_CAP) throw new AppError(429, 'MODEL_DAILY_CAP', 'The policy assistant has reached today’s usage limit. You can still tick rules and edit them by hand.');
  }
  const unavailable = (e: unknown): never => {
    if (e instanceof RuleAssistantUnavailableError) throw new AppError(503, 'ASSISTANT_UNAVAILABLE', aiUnavailableMessage(e, 'The policy assistant', 'Nothing was changed; you can edit the rule by hand.', 'The policy assistant is not available right now. Nothing was changed; try again or edit by hand.'), { reason: aiFailureKind(e) });
    throw e;
  };

  /**
   * Prompt-guided selection (PR-M02): the AI suggests which of the document's rules match the PM's criteria, with a
   * reason each. Suggestions are returned and audited, never stored as rule state; the PM ticks Apply to project.
   * The model is called outside the database transaction.
   */
  app.post('/projects/:projectId/policy/rule-suggestions', { config: { access: POLICY_ACCESS, rateLimit: perSession(20) }, schema: { tags: ['policy'], params: ProjectParams, body: SuggestBody } }, async (req, reply) => {
    const actor = req.actor!;
    const p = await policyProject(db, actor, req.params.projectId);
    const doc = await db.policyDocument.findFirst({ where: { id: req.body.documentId, projectId: p.id } });
    if (!doc) throw notFound('Document not found');
    await checkAiCap(actor.clientId);
    const rules = (await currentVersions(db, actor.clientId, p.id)).filter((r) => r.version.citations.some((c) => c.documentVersion.documentId === doc.id));
    const input: SuggestRule[] = rules.map((r) => {
      const b = PolicyRuleBody.parse(r.version.body);
      return { ruleKey: r.rule.ruleKey, title: b.title, requirement: b.requirement, required: r.rule.required, scope: scopeText(b) };
    });
    const items = input.length ? await assistant.suggest(req.body.prompt, input).catch(unavailable) : [];
    const byKey = new Map(rules.map((r) => [r.rule.ruleKey, r.rule.id]));
    await runCommand(db, req, reply, async ({ audit }) => {
      await audit({ entityType: 'PolicyDocument', entityId: doc.id, action: 'policy.rule_suggestions_requested', after: { model: assistant.modelVersion, prompt: req.body.prompt, rules: items.length, suggested: items.filter((i) => i.match).map((i) => i.ruleKey) } });
      return { status: 200, body: { model: assistant.modelVersion, documentId: doc.id, items: items.map((i) => ({ ...i, ruleId: byKey.get(i.ruleKey) ?? null })) } };
    });
    return reply;
  });

  /**
   * Define with AI (PR-M06): the AI drafts the canonical rule fields from the policy text, quoting the source. Saved as
   * an ordinary draft edit (quotes re-verified by Praxis); never Reviewed or applied by the AI.
   */
  app.post('/projects/:projectId/policy/rules/:ruleId/define', { config: { access: POLICY_ACCESS, rateLimit: perSession(120) }, schema: { tags: ['policy'], params: ProjectParams.extend({ ruleId: z.string().uuid() }), body: DefineBody } }, async (req, reply) => {
    const actor = req.actor!;
    const p = await policyProject(db, actor, req.params.projectId);
    const latest = await db.policyRuleVersion.findFirst({ where: { ruleId: req.params.ruleId, clientId: actor.clientId, rule: { projectId: p.id } }, orderBy: { version: 'desc' }, select: { id: true } });
    if (!latest) throw notFound('Rule not found');
    const v = await ruleVersionFull(db, actor.clientId, latest.id);
    if (v.contentHash !== req.body.expectedContentHash) throw new AppError(409, 'CONFLICT', 'This rule changed since you opened it. Reload to see the latest version.');
    if (v.state === 'REVIEWED') throw new AppError(409, 'APPLIED', 'This rule is applied to the project. Untick Apply to project before redefining it.');
    const dv = v.citations[0]?.documentVersion ?? (v.extractionJobId ? (await db.extractionJob.findUnique({ where: { id: v.extractionJobId }, include: { documentVersion: { include: { document: true } } } }))?.documentVersion : null);
    if (!dv) throw new AppError(422, 'NO_SOURCE', 'This rule has no source document to define it from. Add a quote first.');
    await checkAiCap(actor.clientId);
    const text = (await loadText(dv)).text;
    const body = PolicyRuleBody.parse(v.body);
    const def = await assistant.define({ ruleKey: v.rule.ruleKey, body, quotes: v.citations.map((c) => c.quote), documentText: text }).catch(unavailable);
    const kept = v.citations.map((c) => ({ documentVersionId: c.documentVersionId, fieldPath: c.fieldPath, role: c.role as CitationEdit['role'], quote: c.quote, section: (c.locator as { section?: string | null })?.section ?? null }));
    const fieldPath = (f: string) => (f === 'applicability' ? 'applicability.conditionText' : f);
    const added = def.quotes
      .map((q) => ({ documentVersionId: dv.id, fieldPath: fieldPath(q.fieldPath), role: (q.fieldPath === 'exceptions' ? 'exception' : 'supports') as CitationEdit['role'], quote: q.quote, section: null }))
      .filter((q) => !kept.some((k) => k.fieldPath === q.fieldPath && k.quote.trim() === q.quote.trim()));
    // A verified AI quote replaces an unverified one for the same field; everything else the PM had is kept.
    const citations = [...kept, ...added].slice(0, 50);
    const newBody = PolicyRuleBody.parse({ ...def.body, title: def.body.title || body.title });
    await runCommand(db, req, reply, async ({ tx, actor: a, audit, emit }) => {
      const out = await editRule(tx, { loadText }, { clientId: a.clientId, projectId: p.id, ruleId: v.ruleId, actorId: a.userId, expectedContentHash: v.contentHash, body: newBody, citations }, audit);
      const full = await ruleVersionFull(tx, a.clientId, out.id);
      // Drop AI-added quotes that Praxis could not find in the document, so only verified AI evidence is kept.
      const badAdded = full.citations.filter((c) => c.resolution !== 'RESOLVED' && added.some((x) => x.fieldPath === c.fieldPath && x.quote.trim() === c.quote.trim()) && !kept.some((k) => k.quote.trim() === c.quote.trim()));
      let final = out;
      if (badAdded.length) {
        await tx.policyCitation.deleteMany({ where: { id: { in: badAdded.map((c) => c.id) } } });
        const left = full.citations.filter((c) => !badAdded.some((b) => b.id === c.id));
        final = await tx.policyRuleVersion.update({ where: { id: out.id }, data: { contentHash: contentHash(newBody, left.map((c) => ({ documentVersionId: c.documentVersionId, fieldPath: c.fieldPath, quote: c.quote }))) } });
      }
      const after = await ruleVersionFull(tx, a.clientId, final.id);
      // Define with AI also asks for an annotation when the rule has none (worker, same pass as "Suggest annotations").
      if (!PolicyRuleBody.parse(after.body).annotation) await emit({ name: 'policy.annotation_requested', aggregateType: 'PolicyAnnotationRun', aggregateId: randomUUID(), payload: { clientId: a.clientId, projectId: p.id, documentId: dv.documentId, requestedById: a.userId, requestedRoles: a.roles, trigger: 'manual', ruleKeys: [v.rule.ruleKey] } });
      await audit({ entityType: 'PolicyRuleVersion', entityId: final.id, action: 'policy.rule_ai_defined', after: { model: assistant.modelVersion, ruleKey: v.rule.ruleKey, quotesAdded: added.length - badAdded.length, quotesRejected: badAdded.length, definitionProblems: definitionProblems(after.body) } });
      return { status: 200, body: { versionId: final.id, version: final.version, state: final.state, contentHash: final.contentHash, model: assistant.modelVersion, verifiedQuotes: after.citations.filter((c) => c.resolution === 'RESOLVED').length, rejectedQuotes: badAdded.length, definitionProblems: definitionProblems(after.body), evidenceProblems: evidenceProblems(after) } };
    });
    return reply;
  });

  /**
   * Suggest annotations (PRD-POLICY-RULE-ANNOTATIONS §1, plan §4): queues the AI annotation pass for one document's
   * rules. Suggestions are stored as AI revisions; a PM or Admin still decides by editing and ticking Apply. Asking
   * again while a run is still going returns that run.
   */
  app.post('/projects/:projectId/policy/annotation-suggestions', { config: { access: POLICY_ACCESS, rateLimit: perSession(10) }, schema: { tags: ['policy'], params: ProjectParams, body: AnnotateBody } }, async (req, reply) => {
    const actor = req.actor!;
    const p = await policyProject(db, actor, req.params.projectId);
    const doc = await db.policyDocument.findFirst({ where: { id: req.body.documentId, projectId: p.id } });
    if (!doc) throw notFound('Document not found');
    await checkAiCap(actor.clientId);
    const running = await annotationRun(actor.clientId, doc.id);
    if (running?.status === 'running') return reply.status(200).send(running);
    await runCommand(db, req, reply, async ({ audit, emit }) => {
      const runId = randomUUID();
      await emit({ name: 'policy.annotation_requested', aggregateType: 'PolicyAnnotationRun', aggregateId: runId, payload: { clientId: actor.clientId, projectId: p.id, documentId: doc.id, requestedById: actor.userId, requestedRoles: actor.roles, trigger: 'manual' } });
      await audit({ entityType: 'PolicyDocument', entityId: doc.id, action: ANNOTATION_ACTIONS.requested, after: { runId } });
      return { status: 202, body: { status: 'running', runId, documentId: doc.id } };
    });
    return reply;
  });

  /**
   * KYC Judgment v1 A2: the AI enrichment pass over the project's draft rules (or one document's), a worker job. It
   * suggests library parts and conditions; it never re-extracts, never touches an approved rule and approves nothing.
   * Asking again while a run is still going returns that run.
   */
  app.post('/projects/:projectId/policy/enrichment', { config: { access: POLICY_ACCESS, rateLimit: perSession(10) }, schema: { tags: ['policy'], params: ProjectParams, body: z.object({ documentId: z.string().uuid().optional() }).strict() } }, async (req, reply) => {
    const actor = req.actor!;
    const p = await policyProject(db, actor, req.params.projectId);
    if (req.body.documentId && !(await db.policyDocument.findFirst({ where: { id: req.body.documentId, projectId: p.id } }))) throw notFound('Document not found');
    await checkAiCap(actor.clientId);
    const running = await enrichmentRun(actor.clientId, p.id);
    if (running?.status === 'running') return reply.status(200).send(running);
    await runCommand(db, req, reply, async ({ audit, emit }) => {
      const runId = randomUUID();
      await emit({ name: 'policy.enrichment_requested', aggregateType: 'PolicyEnrichmentRun', aggregateId: runId, payload: { clientId: actor.clientId, projectId: p.id, requestedById: actor.userId, requestedRoles: actor.roles, ...(req.body.documentId ? { documentId: req.body.documentId } : {}) } });
      await audit({ entityType: 'Project', entityId: p.id, action: ENRICHMENT_ACTIONS.requested, after: { runId, ...(req.body.documentId ? { documentId: req.body.documentId } : {}) } });
      return { status: 202, body: { status: 'running', runId } };
    });
    return reply;
  });

  app.get('/projects/:projectId/policy/enrichment', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    return (await enrichmentRun(req.actor!.clientId, p.id)) ?? { status: 'none' };
  });

  /** The latest enrichment run of a project (requested, then suggested / failed / skipped). */
  async function enrichmentRun(clientId: string, projectId: string) {
    const requested = await db.auditEvent.findFirst({ where: { clientId, entityType: 'Project', entityId: projectId, action: ENRICHMENT_ACTIONS.requested }, orderBy: { createdAt: 'desc' } });
    if (!requested) return null;
    const runId = (requested.after as { runId?: string } | null)?.runId ?? '';
    const end = await db.auditEvent.findFirst({ where: { clientId, entityType: 'Project', entityId: projectId, action: { in: [ENRICHMENT_ACTIONS.suggested, ENRICHMENT_ACTIONS.failed, ENRICHMENT_ACTIONS.skipped] }, after: { path: ['runId'], equals: runId } } });
    const status = !end ? 'running' : end.action === ENRICHMENT_ACTIONS.suggested ? 'done' : end.action === ENRICHMENT_ACTIONS.failed ? 'failed' : 'skipped';
    const documentId = (requested.after as { documentId?: string } | null)?.documentId ?? null;
    if (!end) {
      // D-089: the run's event is still in the outbox after a minute, so no worker is taking jobs.
      const waiting = await db.outboxEvent.findFirst({ where: { name: 'policy.enrichment_requested', aggregateId: runId, dispatchedAt: null }, select: { createdAt: true } });
      if (waiting && Date.now() - waiting.createdAt.getTime() > WORKER_PICKUP_MS) return { status: 'no_worker' as const, runId, documentId, requestedAt: requested.createdAt.toISOString(), message: NO_WORKER_MESSAGE };
    }
    return { status, runId, documentId, requestedAt: requested.createdAt.toISOString(), ...(end ? { finishedAt: end.createdAt.toISOString(), result: end.after } : {}) };
  }

  /**
   * D-092: what "Suggest library details (AI)" would cost before it runs, for every draft or one document's drafts. The
   * model is never called. The dollar figure is for Admins only (D7: no cost figures for PMs on project screens).
   */
  app.get('/projects/:projectId/policy/enrichment/estimate', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams, querystring: z.object({ documentId: z.string().uuid().optional() }) } }, async (req) => {
    const actor = req.actor!;
    const p = await policyProject(db, actor, req.params.projectId);
    if (req.query.documentId && !(await db.policyDocument.findFirst({ where: { id: req.query.documentId, projectId: p.id } }))) throw notFound('Document not found');
    const { rules, catalog } = await enrichmentInputs(db, actor.clientId, p.id, req.query.documentId);
    const calls = enrichmentCalls({ catalog, rules });
    // The configured model's price, also where the stand-in runs (live: false), so the figure is what a live run costs.
    const model = policyAiModel(config);
    const price = modelPrice(model, config.POLICY_AI_PRICE_USD_PER_MTOK);
    const cost = estimateUsd(calls, price);
    return {
      rules: rules.length,
      calls: calls.length,
      model,
      live: config.assistantMode === 'vertex',
      ...(isAdmin(actor) ? { estimatedUsd: cost.estimatedUsd, inputTokens: cost.inputTokens, outputTokens: cost.outputTokens, priceSource: price.source } : {}),
    };
  });

  /** The latest annotation run for a document (requested, then suggested / failed / skipped), for the page's progress. */
  async function annotationRun(clientId: string, documentId: string) {
    const events = await db.auditEvent.findMany({ where: { clientId, entityType: 'PolicyDocument', entityId: documentId, action: { in: Object.values(ANNOTATION_ACTIONS) } }, orderBy: { createdAt: 'desc' }, take: 20 });
    const req = events.find((e) => e.action === ANNOTATION_ACTIONS.requested);
    const end = events.find((e) => e.action !== ANNOTATION_ACTIONS.requested);
    if (!req && !end) return null;
    const stale = req && Date.now() - req.createdAt.getTime() > 30 * 60_000;
    if (req && (!end || end.createdAt < req.createdAt) && !stale) return { status: 'running' as const, runId: (req.after as { runId?: string } | null)?.runId ?? null, documentId, requestedAt: req.createdAt };
    if (!end) return { status: 'failed' as const, runId: null, documentId, error: 'The run did not finish within 30 minutes. Try again.' };
    const after = (end.after ?? {}) as Record<string, unknown>;
    const status = end.action === ANNOTATION_ACTIONS.suggested ? 'done' : end.action === ANNOTATION_ACTIONS.skipped ? 'skipped' : 'failed';
    return { status, runId: (after.runId as string) ?? null, documentId, finishedAt: end.createdAt, annotated: after.annotated ?? 0, offered: after.offered ?? 0, model: after.model ?? null, error: after.error ?? after.reason ?? null };
  }

  app.get('/projects/:projectId/policy/annotation-suggestions', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams, querystring: AnnotateBody } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const doc = await db.policyDocument.findFirst({ where: { id: req.query.documentId, projectId: p.id }, select: { id: true } });
    if (!doc) throw notFound('Document not found');
    return (await annotationRun(req.actor!.clientId, doc.id)) ?? { status: 'none', documentId: doc.id };
  });

  app.post('/projects/:projectId/policy/rules', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams, body: ManualRule } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const dv = await tx.policyDocumentVersion.findFirst({ where: { id: req.body.documentVersionId, projectId: p.id } });
      if (!dv) throw notFound('Document version not found');
      assertRuleJurisdiction(req.body.body);
      const text = await loadText(dv);
      const candidate =CandidateRule.parse({ ...req.body.body, ruleKey: req.body.ruleKey ?? null, citations: req.body.citations.map((c) => ({ fieldPath: c.fieldPath, role: c.role, quote: c.quote, page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: null })) });
      const r = await createRuleFromCandidate(tx, { clientId: actor.clientId, projectId: p.id, documentVersion: dv, doc: { ...text, format: dv.format }, candidate, origin: 'manual', editedById: actor.userId, ruleKey: req.body.ruleKey ?? null });
      await audit({ entityType: 'PolicyRuleVersion', entityId: r.version.id, action: 'policy.rule_created', after: { ruleKey: r.rule.ruleKey, state: r.version.state } });
      return { status: 201, body: { ruleId: r.rule.id, ruleKey: r.rule.ruleKey, versionId: r.version.id, state: r.version.state, contentHash: r.version.contentHash } };
    });
    return reply;
  });

  app.put('/projects/:projectId/policy/rules/:ruleId', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ ruleId: z.string().uuid() }), body: EditBody } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      assertRuleJurisdiction(req.body.body);
      const annotationSave ={ source: 'AUTHOR_EDIT' as const, editedById: actor.userId, editedRole: editorRole(actor.roles), basedOnRevisionId: req.body.annotationBasedOnRevisionId ?? null };
      const v = await editRule(tx, { loadText }, { clientId: actor.clientId, projectId: p.id, ruleId: req.params.ruleId, actorId: actor.userId, expectedContentHash: req.body.expectedContentHash, body: req.body.body, citations: req.body.citations as CitationEdit[] | undefined, annotationSave }, audit);
      return { status: 200, body: { versionId: v.id, version: v.version, state: v.state, contentHash: v.contentHash } };
    });
    return reply;
  });

  /**
   * Edit only the annotation (marking, applies when, why, …) through the same rule edit: new annotation version, a new
   * draft rule version if the rule is applied (tick it again), the source quotation untouched (spec §4).
   */
  app.put('/projects/:projectId/policy/rules/:ruleId/annotation', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ ruleId: z.string().uuid() }), body: AnnotationEdit } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const latest = await tx.policyRuleVersion.findFirst({ where: { ruleId: req.params.ruleId, clientId: actor.clientId, rule: { projectId: p.id } }, orderBy: { version: 'desc' } });
      if (!latest) throw notFound('Rule not found');
      if (req.body.basedOnRevisionId && !(await tx.policyRuleAnnotationRevision.findFirst({ where: { id: req.body.basedOnRevisionId, ruleId: req.params.ruleId, clientId: actor.clientId }, select: { id: true } }))) throw notFound('Annotation revision not found');
      const body = { ...PolicyRuleBody.parse(latest.body), annotation: { ...req.body.annotation, version: 1 } };
      const annotationSave = { source: 'AUTHOR_EDIT' as const, editedById: actor.userId, editedRole: editorRole(actor.roles), basedOnRevisionId: req.body.basedOnRevisionId ?? null };
      const v = await editRule(tx, { loadText }, { clientId: actor.clientId, projectId: p.id, ruleId: req.params.ruleId, actorId: actor.userId, expectedContentHash: req.body.expectedContentHash, body, annotationSave }, audit);
      const saved = PolicyRuleBody.parse(v.body).annotation!;
      return { status: 200, body: { versionId: v.id, version: v.version, state: v.state, contentHash: v.contentHash, annotationVersion: saved.version, applied: v.state === 'REVIEWED' } };
    });
    return reply;
  });

  app.post('/projects/:projectId/policy/rule-versions/:versionId/review', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ versionId: z.string().uuid() }), body: Decision } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const target = await tx.policyRuleVersion.findFirst({ where: { id: req.params.versionId, clientId: actor.clientId, rule: { projectId: p.id } }, select: { ruleId: true, rule: { select: { ruleKey: true } } } });
      if (target) await assertApprovable(tx, { clientId: actor.clientId, projectId: p.id, ruleId: target.ruleId, ruleKey: target.rule.ruleKey });
      const v = await markReviewed(tx, { clientId: actor.clientId, projectId: p.id, ruleVersionId: req.params.versionId, actorId: actor.userId, expectedContentHash: req.body.expectedContentHash, required: req.body.required }, audit);
      return { status: 200, body: { versionId: v.id, state: v.state, reviewedAt: v.reviewedAt } };
    });
    return reply;
  });

  app.post('/projects/:projectId/policy/rule-versions/:versionId/exclude', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ versionId: z.string().uuid() }), body: ExcludeBody } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const v = await markExcluded(tx, { clientId: actor.clientId, projectId: p.id, ruleVersionId: req.params.versionId, actorId: actor.userId, expectedContentHash: req.body.expectedContentHash, reason: req.body.reason }, audit);
      return { status: 200, body: { versionId: v.id, state: v.state } };
    });
    return reply;
  });

  // D-094: bring an excluded rule back for review (a new draft; the excluded version and its reason stay in the history).
  app.post('/projects/:projectId/policy/rules/:ruleId/restore', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ ruleId: z.string().uuid() }), body: ExcludeBody } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const out = await restoreExcluded(tx, { clientId: actor.clientId, projectId: p.id, ruleId: req.params.ruleId, actorId: actor.userId, expectedContentHash: req.body.expectedContentHash, reason: req.body.reason }, audit);
      return { status: 200, body: { versionId: out.version.id, state: out.version.state, changed: out.changed } };
    });
    return reply;
  });

  // ───────── Rule sets (slice 5) ─────────
  app.get('/projects/:projectId/policy/rule-set/preview', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const preview = await previewRuleSet(db, req.actor!.clientId, p.id);
    const tasks = await db.taskInstance.count({ where: { projectId: p.id } });
    return { ...preview, inheritanceMode: 'ALL_TASKS', affectedTasks: tasks };
  });

  app.post('/projects/:projectId/policy/rule-set', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams, body: PublishBody } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const r = await publishRuleSet(tx, { clientId: actor.clientId, projectId: p.id, actorId: actor.userId, expectedLatestVersion: req.body.expectedLatestVersion }, audit);
      if (!r.created) await audit({ entityType: 'ProjectRuleSet', entityId: r.set.id, action: 'policy.rule_set_republished_identical', after: { version: r.set.version } });
      return { status: r.created ? 201 : 200, body: { id: r.set.id, version: r.set.version, digest: r.set.digest, created: r.created } };
    });
    return reply;
  });

  app.get('/projects/:projectId/policy/rule-sets', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const sets = await db.projectRuleSet.findMany({ where: { projectId: p.id }, orderBy: { version: 'desc' }, select: { id: true, version: true, digest: true, ruleVersionIds: true, publishedById: true, createdAt: true, content: true } });
    // Rules per mandatory marking in each published version (`not_annotated` for rules published without one).
    const markingCounts = (content: unknown) => {
      const out: Record<string, number> = {};
      for (const r of ProjectRuleSetContent.parse(content).rules) {
        const m = r.body.annotation?.marking ?? 'not_annotated';
        out[m] = (out[m] ?? 0) + 1;
      }
      return out;
    };
    return { items: sets.map(({ content, ...s }) => ({ ...s, ruleCount: s.ruleVersionIds.length, markingCounts: markingCounts(content) })) };
  });

  // ───────── Task policy (slice 6) ─────────
  app.get('/tasks/:taskId/policy', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: TaskParams } }, async (req) => {
    const actor = req.actor!;
    const t = await policyTask(db, actor, req.params.taskId);
    const eff = await effectivePolicy(db, actor.clientId, t);
    const latest = await db.taskPolicySnapshot.findFirst({ where: { taskInstanceId: t.id }, orderBy: { version: 'desc' } });
    const changes = await db.taskPolicyChange.findMany({ where: { taskInstanceId: t.id, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    if (!eff) return { configured: false, snapshot: null, changes: [], rules: [], anvil: 'Not tested' };
    const cits = await db.policyCitation.findMany({ where: { ruleVersionId: { in: eff.body.rules.map((r) => r.rule_version_id) } }, select: { id: true, ruleVersionId: true, role: true, quote: true } });
    return {
      configured: true,
      citations: cits.map((c) => ({ id: c.id, ruleVersionId: c.ruleVersionId, role: c.role, quote: c.quote.slice(0, 300) })),
      ruleSet: eff.body.project_rule_set,
      rules: eff.body.rules,
      changes,
      rubricVersion: eff.body.rubric_version,
      effectiveDigest: eff.digest,
      snapshot: latest && { id: latest.id, version: latest.version, digest: latest.digest, createdAt: latest.createdAt, current: latest.digest === eff.digest },
      readiness: { published: !!latest && latest.digest === eff.digest, sourcesComplete: eff.body.rules.every((r) => r.sources.length > 0), anvil: 'Not tested' },
    };
  });

  app.post('/tasks/:taskId/policy/changes', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: TaskParams, body: TaskChangeInput } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await policyTask(tx, actor, req.params.taskId);
      const row = await addChange(tx, { clientId: actor.clientId, projectId: t.projectId, taskId: t.id, actorId: actor.userId, change: req.body }, audit);
      return { status: 201, body: { id: row.id } };
    });
    return reply;
  });

  app.delete('/tasks/:taskId/policy/changes/:changeId', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: TaskParams.extend({ changeId: z.string().uuid() }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await policyTask(tx, actor, req.params.taskId);
      await removeChange(tx, { clientId: actor.clientId, taskId: t.id, changeId: req.params.changeId }, audit);
      return { status: 204, body: undefined };
    });
    return reply;
  });

  app.post('/tasks/:taskId/policy/snapshot', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: TaskParams } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const t = await policyTask(tx, actor, req.params.taskId);
      const r = await snapshotTask(tx, { clientId: actor.clientId, task: t, actorId: actor.userId });
      if (!r) throw new AppError(409, 'NO_RULE_SET', 'This project has no published rule set.');
      await audit({ entityType: 'TaskPolicySnapshot', entityId: r.snapshot.id, action: r.created ? 'policy.task_snapshot_requested' : 'policy.task_snapshot_reused', after: { version: r.snapshot.version, digest: r.snapshot.digest } });
      return { status: r.created ? 201 : 200, body: { id: r.snapshot.id, version: r.snapshot.version, digest: r.snapshot.digest, created: r.created } };
    });
    return reply;
  });

  app.get('/tasks/:taskId/policy/snapshots/:snapshotId/export', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: TaskParams.extend({ snapshotId: z.string().uuid() }) } }, async (req, reply) => {
    const t = await policyTask(db, req.actor!, req.params.taskId);
    const s = await db.taskPolicySnapshot.findFirst({ where: { id: req.params.snapshotId, taskInstanceId: t.id } });
    if (!s) throw notFound('Snapshot not found');
    return reply.header('content-disposition', `attachment; filename="policy-${t.id}-v${s.version}.json"`).header('cache-control', 'private, no-store').send(sidecar(s));
  });
};
