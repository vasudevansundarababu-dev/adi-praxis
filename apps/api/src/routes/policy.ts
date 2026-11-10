import '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CandidateRule, LOCATOR_GRANULARITY, PolicyRuleBody, TaskChangeInput } from '@praxis/shared';
import type { MalwareScanner, ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import { AppError, badRequest, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { POLICY_ACCESS, isAdmin, policyProject, policyTask, requireAdmin } from '../policy/access';
import { MAX_POLICY_BYTES, readPolicyDocument } from '../policy/document-reader';
import { addDocumentVersion, loadVersionText } from '../policy/documents';
import { startBatch, spentUsd, type Adapters } from '../policy/extraction/service';
import { ensureProfiles } from '../policy/profiles';
import { previewRuleSet, publishRuleSet } from '../policy/rule-sets';
import { createRuleFromCandidate, currentVersions, editRule, markExcluded, markReviewed, reviewProblems, ruleVersionFull, type CitationEdit } from '../policy/rules';
import { addChange, effectivePolicy, removeChange, sidecar, snapshotTask } from '../policy/task-policy';

const ProjectParams = z.object({ projectId: z.string().uuid() });
/** Per signed-in session rather than per IP, so colleagues behind one office address do not share a limit. */
const perSession = (max: number) => ({ max, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => req.cookies?.praxis_session ?? req.ip });
const TaskParams = z.object({ taskId: z.string().uuid() });
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
const EditBody = z.object({ expectedContentHash: z.string().length(64), body: PolicyRuleBody, citations: z.array(CitationIn).max(50).optional() });
const Decision = z.object({ expectedContentHash: z.string().length(64), required: z.boolean().optional() });
const ExcludeBody = z.object({ expectedContentHash: z.string().length(64), reason: z.string().trim().min(1).max(1000) });
const PublishBody = z.object({ expectedLatestVersion: z.number().int().positive().nullable() });
const ProfileSetting = z.object({ profileId: z.string().max(100) });
const ProfilePatch = z.object({ enabled: z.boolean() });

function versionDto(v: { id: string; version: number; sha256: string; fileName: string; format: string; mediaType: string; sizeBytes: number; pageCount: number; pageCountMethod: string; locatorGranularity: string; origin: string; createdAt: Date }) {
  return { id: v.id, version: v.version, sha256: v.sha256, fileName: v.fileName, format: v.format, mediaType: v.mediaType, sizeBytes: v.sizeBytes, pageCount: v.pageCount, pageCountMethod: v.pageCountMethod, locatorGranularity: v.locatorGranularity, origin: v.origin, createdAt: v.createdAt };
}

function ruleDto(r: Awaited<ReturnType<typeof currentVersions>>[number]) {
  const b = PolicyRuleBody.parse(r.version.body);
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
    sources: r.version.citations.map((c) => ({ document: c.documentVersion.document.title, documentVersion: c.documentVersion.version, locator: c.locator, resolution: c.resolution })),
  };
}

/**
 * Policy Rules (docs/prd/PRD-POLICY-RULES.md, docs/architecture/ARCH-POLICY-RULES.md). Owning PM and Admin only;
 * every change goes through runCommand (idempotency, audit, outbox in one transaction).
 */
export const policyRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; storage: ObjectStorage; scanner: MalwareScanner; adapters: Adapters }> = async (app, { db, config, storage, scanner, adapters }) => {
  const policy = config.policy;
  const loadText = (v: { textStorageKey: string }) => loadVersionText(storage, v);

  // ───────── Documents (slice 1) ─────────
  app.get('/projects/:projectId/policy/documents', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const docs = await db.policyDocument.findMany({ where: { projectId: p.id, archivedAt: null }, orderBy: { createdAt: 'asc' }, include: { versions: { orderBy: { version: 'desc' } } } });
    return {
      maxPages: policy.maxPages,
      items: docs.map((d) => ({ id: d.id, title: d.title, category: d.category, language: d.language, jurisdiction: d.jurisdiction, effectiveFrom: d.effectiveFrom, effectiveTo: d.effectiveTo, latestVersion: d.latestVersion, versions: d.versions.map(versionDto) })),
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
    const budget = resolved ? { provider: resolved.provider, ceilingUsd: policy.budgets[resolved.provider as keyof typeof policy.budgets], spentUsd: await spentUsd(db, resolved.provider as 'llamaextract' | 'google'), usdPerPage: policy.prices[resolved.provider as keyof typeof policy.prices] } : null;
    return {
      profile: resolved && { id: resolved.id, label: resolved.label, provider: resolved.provider, revision: resolved.revision, source: setting ? 'project' : 'deployment' },
      available: problems.length === 0,
      problems,
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
        jobs: b.jobs.map((j) => ({ id: j.id, status: j.status, provider: j.provider, documentVersionId: j.documentVersionId, document: j.documentVersion.document.title, documentVersion: j.documentVersion.version, candidateCount: j.candidateCount, error: j.error, finishedAt: j.finishedAt, ...(isAdmin(actor) ? { estimatedUsd: Number(j.estimatedUsd), actualUsd: j.actualUsd === null ? null : Number(j.actualUsd) } : {}) })),
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
    return { items: items.map(ruleDto) };
  });

  app.get('/projects/:projectId/policy/rule-versions/:versionId', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ versionId: z.string().uuid() }) } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const v = await ruleVersionFull(db, req.actor!.clientId, req.params.versionId);
    if (v.rule.projectId !== p.id) throw notFound('Rule version not found');
    const history = await db.policyRuleVersion.findMany({ where: { ruleId: v.ruleId }, orderBy: { version: 'desc' }, select: { id: true, version: true, state: true, reviewedAt: true, createdAt: true } });
    return {
      ruleId: v.ruleId,
      ruleKey: v.rule.ruleKey,
      required: v.rule.required,
      versionId: v.id,
      version: v.version,
      state: v.state,
      contentHash: v.contentHash,
      body: v.body,
      excludeReason: v.excludeReason,
      reviewedById: v.reviewedById,
      reviewedAt: v.reviewedAt,
      origin: v.origin,
      problems: v.state === 'REVIEWED' || v.state === 'EXCLUDED' ? [] : reviewProblems(v),
      citations: v.citations.map((c) => ({ id: c.id, fieldPath: c.fieldPath, role: c.role, quote: c.quote, locator: c.locator, resolution: c.resolution, documentVersionId: c.documentVersionId, document: c.documentVersion.document.title, documentVersion: c.documentVersion.version, sha256: c.documentVersion.sha256, format: c.documentVersion.format })),
      history,
    };
  });

  app.post('/projects/:projectId/policy/rules', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams, body: ManualRule } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const dv = await tx.policyDocumentVersion.findFirst({ where: { id: req.body.documentVersionId, projectId: p.id } });
      if (!dv) throw notFound('Document version not found');
      const text = await loadText(dv);
      const candidate = CandidateRule.parse({ ...req.body.body, ruleKey: req.body.ruleKey ?? null, citations: req.body.citations.map((c) => ({ fieldPath: c.fieldPath, role: c.role, quote: c.quote, page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: null })) });
      const r = await createRuleFromCandidate(tx, { clientId: actor.clientId, projectId: p.id, documentVersion: dv, doc: { ...text, format: dv.format }, candidate, origin: 'manual', editedById: actor.userId, ruleKey: req.body.ruleKey ?? null });
      await audit({ entityType: 'PolicyRuleVersion', entityId: r.version.id, action: 'policy.rule_created', after: { ruleKey: r.rule.ruleKey, state: r.version.state } });
      return { status: 201, body: { ruleId: r.rule.id, ruleKey: r.rule.ruleKey, versionId: r.version.id, state: r.version.state, contentHash: r.version.contentHash } };
    });
    return reply;
  });

  app.put('/projects/:projectId/policy/rules/:ruleId', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ ruleId: z.string().uuid() }), body: EditBody } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const v = await editRule(tx, { loadText }, { clientId: actor.clientId, projectId: p.id, ruleId: req.params.ruleId, actorId: actor.userId, expectedContentHash: req.body.expectedContentHash, body: req.body.body, citations: req.body.citations as CitationEdit[] | undefined }, audit);
      return { status: 200, body: { versionId: v.id, version: v.version, state: v.state, contentHash: v.contentHash } };
    });
    return reply;
  });

  app.post('/projects/:projectId/policy/rule-versions/:versionId/review', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ versionId: z.string().uuid() }), body: Decision } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
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
    const sets = await db.projectRuleSet.findMany({ where: { projectId: p.id }, orderBy: { version: 'desc' }, select: { id: true, version: true, digest: true, ruleVersionIds: true, publishedById: true, createdAt: true } });
    return { items: sets.map((s) => ({ ...s, ruleCount: s.ruleVersionIds.length })) };
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
