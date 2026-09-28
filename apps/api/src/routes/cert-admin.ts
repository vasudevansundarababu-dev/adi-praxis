import '@fastify/multipart';
import type { Prisma } from '@prisma/client';
import { AnswerRule, PassRules, ruleProblems, SME_TIERS, TIER_LABELS, VariableSchema } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ObjectStorage } from '../candidate/storage';
import type { Db } from '../db';
import { AppError, badRequest, notFound } from '../lib/errors';
import type { SecretBox } from '../lib/secrets';
import { runCommand } from '../platform/command';
import { confirmGrade, decideCertification, decideLicence, finalizeTx, notifyCertification } from '../cert/attempts';
import { keyOf } from '../cert/items';
import { ingestVersion } from '../cert/pipeline';
import { notifyPartner } from '../supply/webhooks';

const IdParams = z.object({ id: z.string().uuid() });
const ADMIN = ['ADMIN'] as const;
const REVIEW = ['ADMIN', 'REVIEWER'] as const;
const READ = ['ADMIN', 'PM', 'REVIEWER'] as const;
const MAX_GUIDELINES_BYTES = 10 * 1024 * 1024;

/**
 * M10b internal routes (docs/SME-SUPPLY.md section 7.6): guidelines upload and versions → generation run status →
 * knowledge map review → course review per tier → blueprint and item-family review (with samples) → publish; the
 * certification review queue for written answers, failures and licences.
 */
export const certAdminRoutes: FastifyPluginAsyncZod<{ db: Db; storage: ObjectStorage; box: SecretBox }> = async (app, { db, storage, box }) => {
  // ── Guidelines packages and versions ──
  app.get('/guidelines/packages', { config: { access: READ }, schema: { tags: ['cert'] } }, async (req) => {
    const rows = await db.guidelinesPackage.findMany({ where: { clientId: req.actor!.clientId }, include: { versions: { orderBy: { version: 'desc' }, select: { id: true, version: true, status: true, publishedTiers: true, major: true, createdAt: true } } }, orderBy: { name: 'asc' } });
    return { items: rows.map((p) => ({ id: p.id, domain: p.domain, taskFamily: p.taskFamily, name: p.name, versions: p.versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })) })) };
  });

  app.post('/guidelines/packages', { config: { access: ADMIN }, schema: { tags: ['cert'], body: z.object({ domain: z.string().trim().min(2).max(60), taskFamily: z.string().trim().min(2).max(120), name: z.string().trim().min(2).max(200) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const domain = req.body.domain.toLowerCase();
      if (await tx.guidelinesPackage.findUnique({ where: { clientId_domain_taskFamily: { clientId: actor.clientId, domain, taskFamily: req.body.taskFamily } } })) throw new AppError(409, 'PACKAGE_EXISTS', 'A package for this domain and task family already exists; upload a new version to it.');
      const p = await tx.guidelinesPackage.create({ data: { clientId: actor.clientId, domain, taskFamily: req.body.taskFamily, name: req.body.name } });
      await audit({ entityType: 'GuidelinesPackage', entityId: p.id, action: 'cert.package_created', after: { domain, taskFamily: p.taskFamily } });
      return { status: 201, body: { id: p.id, domain: p.domain, taskFamily: p.taskFamily, name: p.name } };
    });
    return reply;
  });

  app.post('/guidelines/packages/:id/versions', { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_GUIDELINES_BYTES + 1, files: 1, fields: 3 } });
    if (!file) throw badRequest('Attach the guidelines (PDF, DOCX, Markdown or text)');
    const major = (file.fields.major as { value?: string } | undefined)?.value !== 'false';
    const buf = await file.toBuffer();
    if (file.file.truncated || buf.length > MAX_GUIDELINES_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
    await runCommand(db, req, reply, async ({ tx, actor, audit, emit }) => {
      const p = await tx.guidelinesPackage.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!p) throw notFound('Package not found');
      const { version, run: r } = await ingestVersion(tx, storage, { clientId: actor.clientId, packageId: p.id, fileName: file.filename, buf, major, userId: actor.userId }, (e) => emit(e));
      await audit({ entityType: 'GuidelinesVersion', entityId: version.id, action: 'cert.guidelines_uploaded', after: { packageId: p.id, version: version.version, major, sha256: version.sha256, sections: (version.sections as unknown[]).length, runId: r.id } });
      return { status: 201, body: { id: version.id, version: version.version, status: version.status, sections: (version.sections as unknown[]).length, runId: r.id } };
    });
    return reply;
  });

  app.get('/guidelines/versions/:id', { config: { access: REVIEW }, schema: { tags: ['cert'], params: IdParams } }, async (req) => {
    const v = await db.guidelinesVersion.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId }, include: { package: true, runs: { orderBy: { createdAt: 'desc' }, take: 20 }, knowledge: { orderBy: [{ citation: 'asc' }, { createdAt: 'asc' }] }, courses: { include: { modules: { select: { id: true } } } }, blueprints: { include: { families: { select: { id: true, status: true, itemType: true, competency: true } } } } } });
    if (!v) throw notFound('Version not found');
    const tiers = SME_TIERS.map((tier) => {
      const course = v.courses.find((c) => c.tier === tier);
      const bp = v.blueprints.find((b) => b.tier === tier);
      const comps = (bp?.competencies ?? []) as { key: string }[];
      const approved = bp?.families.filter((f) => f.status === 'APPROVED') ?? [];
      const missing = [
        ...(course?.status === 'APPROVED' ? [] : ['course']),
        ...(bp?.status === 'APPROVED' ? [] : ['blueprint']),
        ...comps.filter((c) => !approved.some((f) => f.competency === c.key && f.itemType !== 'AUTHORING')).map((c) => `family for ${c.key}`),
        ...(bp?.authoringTask && !approved.some((f) => f.itemType === 'AUTHORING') ? ['authoring-task family'] : []),
      ];
      return {
        tier,
        tierLabel: TIER_LABELS[tier],
        published: v.publishedTiers.includes(tier),
        course: course ? { id: course.id, status: course.status, modules: course.modules.length } : null,
        blueprint: bp ? { id: bp.id, status: bp.status, itemCount: bp.itemCount, timeLimitMinutes: bp.timeLimitMinutes, families: bp.families.length, approvedFamilies: approved.length, flaggedFamilies: bp.families.filter((f) => f.status === 'FLAGGED').length } : null,
        readyToPublish: missing.length === 0,
        missing,
      };
    });
    return {
      id: v.id,
      package: { id: v.package.id, domain: v.package.domain, taskFamily: v.package.taskFamily, name: v.package.name },
      version: v.version,
      major: v.major,
      status: v.status,
      fileName: v.fileName,
      sha256: v.sha256,
      sections: v.sections,
      runs: v.runs.map((r) => ({ id: r.id, scope: r.scope, target: r.target, stage: r.stage, status: r.status, model: r.model, promptVersions: r.promptVersions, cost: r.cost, error: r.error, createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null })),
      knowledge: v.knowledge.map((k) => ({ id: k.id, kind: k.kind, text: k.text, citation: k.citation, critical: k.critical, status: k.status })),
      tiers,
    };
  });

  app.get('/guidelines/versions/:id/source', { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams } }, async (req, reply) => {
    const v = await db.guidelinesVersion.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId } });
    if (!v) throw notFound('Version not found');
    return reply.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="${v.fileName.replace(/"/g, '')}"`).header('cache-control', 'private, no-store').send(await storage.get(v.storageKey));
  });

  app.post(
    '/guidelines/versions/:id/regenerate',
    { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams, body: z.object({ scope: z.enum(['FULL', 'KNOWLEDGE', 'COURSE', 'BLUEPRINT', 'FAMILIES']), tier: z.enum(SME_TIERS).optional() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const v = await tx.guidelinesVersion.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
        if (!v) throw notFound('Version not found');
        if (req.body.tier && v.publishedTiers.includes(req.body.tier)) throw new AppError(409, 'TIER_PUBLISHED', 'This tier is published; upload a new version to change it.');
        if (await tx.generationRun.findFirst({ where: { versionId: v.id, status: { in: ['QUEUED', 'RUNNING'] } } })) throw new AppError(409, 'RUN_IN_PROGRESS', 'A generation run is already in progress for this version.');
        const r = await tx.generationRun.create({ data: { clientId: v.clientId, versionId: v.id, scope: req.body.scope, target: req.body.tier ? { tier: req.body.tier } : {}, createdById: actor.userId } });
        await tx.outboxEvent.create({ data: { clientId: v.clientId, name: 'guidelines.generate', aggregateType: 'GenerationRun', aggregateId: r.id, payload: { runId: r.id } } });
        await audit({ entityType: 'GuidelinesVersion', entityId: v.id, action: 'cert.regeneration_requested', after: { runId: r.id, scope: req.body.scope, tier: req.body.tier ?? null } });
        return { status: 202, body: { runId: r.id } };
      });
      return reply;
    },
  );

  // ── Knowledge map ──
  app.patch('/knowledge-items/:id', { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams, body: z.object({ text: z.string().trim().min(3).max(1000).optional(), status: z.enum(['APPROVED', 'REJECTED', 'DRAFT']).optional(), critical: z.boolean().optional() }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const k = await tx.knowledgeItem.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!k) throw notFound('Knowledge item not found');
      const u = await tx.knowledgeItem.update({ where: { id: k.id }, data: req.body });
      await audit({ entityType: 'KnowledgeItem', entityId: k.id, action: 'cert.knowledge_updated', before: { text: k.text, status: k.status }, after: req.body });
      return { status: 200, body: { id: u.id, text: u.text, status: u.status, critical: u.critical } };
    });
    return reply;
  });

  // ── Courses ──
  app.get('/courses/:id', { config: { access: REVIEW }, schema: { tags: ['cert'], params: IdParams } }, async (req) => {
    const c = await db.course.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId }, include: { modules: { orderBy: { position: 'asc' } } } });
    if (!c) throw notFound('Course not found');
    return { id: c.id, versionId: c.versionId, tier: c.tier, title: c.title, status: c.status, model: c.model, promptVersion: c.promptVersion, approvedAt: c.approvedAt?.toISOString() ?? null, modules: c.modules.map((m) => ({ id: m.id, position: m.position, title: m.title, explanation: m.explanation, goodExamples: m.goodExamples, badExamples: m.badExamples, quiz: m.quiz, practice: m.practice, citations: m.citations })) };
  });

  app.patch(
    '/course-modules/:id',
    { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams, body: z.object({ title: z.string().trim().min(3).max(200).optional(), explanation: z.string().trim().min(10).max(8000).optional(), quiz: z.array(z.object({ question: z.string().min(5), options: z.array(z.string().min(1)).min(2).max(6), answerIndex: z.number().int().min(0), feedback: z.string(), citation: z.string() })).min(1).max(8).optional() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const m = await tx.courseModule.findFirst({ where: { id: req.params.id, clientId: actor.clientId }, include: { course: { include: { version: true } } } });
        if (!m) throw notFound('Module not found');
        if (m.course.version.publishedTiers.includes(m.course.tier)) throw new AppError(409, 'TIER_PUBLISHED', 'This course is published; upload a new version to change it.');
        if (req.body.quiz?.some((q) => q.answerIndex >= q.options.length)) throw badRequest('Each quiz answer must be one of its options.');
        await tx.courseModule.update({ where: { id: m.id }, data: { ...req.body, ...(req.body.quiz ? { quiz: req.body.quiz as Prisma.InputJsonValue } : {}) } });
        // Any edit sends the course back for approval.
        await tx.course.update({ where: { id: m.courseId }, data: { status: 'DRAFT', approvedById: null, approvedAt: null } });
        await audit({ entityType: 'CourseModule', entityId: m.id, action: 'cert.module_edited', after: Object.keys(req.body) });
        return { status: 200, body: { id: m.id } };
      });
      return reply;
    },
  );

  app.post('/courses/:id/decision', { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams, body: z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(1000).default('') }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const c = await tx.course.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!c) throw notFound('Course not found');
      const status = req.body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.course.update({ where: { id: c.id }, data: { status, approvedById: status === 'APPROVED' ? actor.userId : null, approvedAt: status === 'APPROVED' ? new Date() : null } });
      await audit({ entityType: 'Course', entityId: c.id, action: `cert.course_${status.toLowerCase()}`, after: { tier: c.tier, note: req.body.note } });
      return { status: 200, body: { id: c.id, status } };
    });
    return reply;
  });

  // ── Blueprints and item families ──
  app.get('/blueprints/:id', { config: { access: REVIEW }, schema: { tags: ['cert'], params: IdParams } }, async (req) => {
    const b = await db.certificationBlueprint.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId }, include: { families: { where: { status: { not: 'REJECTED' } }, orderBy: [{ competency: 'asc' }, { createdAt: 'asc' }], include: { instances: { where: { status: 'SAMPLE' }, orderBy: { createdAt: 'desc' }, take: 10 } } } } });
    if (!b) throw notFound('Blueprint not found');
    return {
      id: b.id,
      versionId: b.versionId,
      tier: b.tier,
      status: b.status,
      competencies: b.competencies,
      itemCount: b.itemCount,
      authoringTask: b.authoringTask,
      timeLimitMinutes: b.timeLimitMinutes,
      passRules: b.passRules,
      families: b.families.map((f) => ({
        id: f.id,
        competency: f.competency,
        difficultyMin: f.difficultyMin,
        difficultyMax: f.difficultyMax,
        cognitiveLevel: f.cognitiveLevel,
        itemType: f.itemType,
        stemPattern: f.stemPattern,
        variableSchema: f.variableSchema,
        answerRule: f.answerRule,
        options: f.options,
        distractorRationale: f.distractorRationale,
        citation: f.citation,
        critical: f.critical,
        status: f.status,
        approvals: f.approvals,
        stats: f.stats,
        // Reviewers see the derived answer of each sample, and how it passed the four checks.
        samples: f.instances.map((i) => ({ id: i.id, stem: i.stem, content: i.content, variables: i.variables, key: keyOf(box, i.keyEnc), validation: i.validation, createdAt: i.createdAt.toISOString() })),
      })),
    };
  });

  app.patch(
    '/blueprints/:id',
    { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams, body: z.object({ itemCount: z.number().int().min(5).max(100).optional(), timeLimitMinutes: z.number().int().min(10).max(300).optional(), passRules: PassRules.optional(), competencies: z.array(z.object({ key: z.string(), name: z.string(), weight: z.number().int().min(1).max(100), citations: z.array(z.string()) })).min(1).optional() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const b = await tx.certificationBlueprint.findFirst({ where: { id: req.params.id, clientId: actor.clientId }, include: { version: true } });
        if (!b) throw notFound('Blueprint not found');
        if (b.version.publishedTiers.includes(b.tier)) throw new AppError(409, 'TIER_PUBLISHED', 'This blueprint is published; upload a new version to change it.');
        if (req.body.competencies && req.body.competencies.reduce((n, c) => n + c.weight, 0) !== 100) throw badRequest('Competency weights must sum to 100.');
        const u = await tx.certificationBlueprint.update({ where: { id: b.id }, data: { ...req.body, ...(req.body.passRules ? { passRules: req.body.passRules as Prisma.InputJsonValue } : {}), ...(req.body.competencies ? { competencies: req.body.competencies as Prisma.InputJsonValue } : {}), status: 'DRAFT', approvedById: null, approvedAt: null } });
        await audit({ entityType: 'CertificationBlueprint', entityId: b.id, action: 'cert.blueprint_edited', before: { itemCount: b.itemCount, timeLimitMinutes: b.timeLimitMinutes, passRules: b.passRules }, after: req.body });
        return { status: 200, body: { id: u.id, status: u.status } };
      });
      return reply;
    },
  );

  app.post('/blueprints/:id/decision', { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams, body: z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(1000).default('') }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const b = await tx.certificationBlueprint.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!b) throw notFound('Blueprint not found');
      const status = req.body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.certificationBlueprint.update({ where: { id: b.id }, data: { status, approvedById: status === 'APPROVED' ? actor.userId : null, approvedAt: status === 'APPROVED' ? new Date() : null } });
      await audit({ entityType: 'CertificationBlueprint', entityId: b.id, action: `cert.blueprint_${status.toLowerCase()}`, after: { tier: b.tier, note: req.body.note } });
      return { status: 200, body: { id: b.id, status } };
    });
    return reply;
  });

  app.patch(
    '/item-families/:id',
    { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams, body: z.object({ stemPattern: z.string().min(10).max(4000).optional(), options: z.array(z.string().min(1)).max(10).optional(), variableSchema: VariableSchema.optional(), answerRule: AnswerRule.optional(), critical: z.boolean().optional(), difficultyMin: z.number().int().min(1).max(5).optional(), difficultyMax: z.number().int().min(1).max(5).optional() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const f = await tx.itemFamily.findFirst({ where: { id: req.params.id, clientId: actor.clientId }, include: { blueprint: { include: { version: true } } } });
        if (!f) throw notFound('Item family not found');
        if (f.blueprint.version.publishedTiers.includes(f.blueprint.tier)) throw new AppError(409, 'TIER_PUBLISHED', 'This tier is published; upload a new version to change it.');
        const schema = req.body.variableSchema ?? VariableSchema.parse(f.variableSchema);
        const rule = req.body.answerRule ?? AnswerRule.parse(f.answerRule);
        const problems = ruleProblems(rule, schema, req.body.options ?? f.options);
        if (problems.length) throw new AppError(422, 'INVALID_RULE', problems.join('; '));
        // An edited family must be sampled and approved again; old samples no longer represent it.
        await tx.itemInstance.updateMany({ where: { familyId: f.id, status: 'SAMPLE' }, data: { status: 'DISCARDED' } });
        await tx.itemFamily.update({ where: { id: f.id }, data: { ...req.body, variableSchema: schema as Prisma.InputJsonValue, answerRule: rule as Prisma.InputJsonValue, status: 'DRAFT', approvals: [], stats: { ...(f.stats as object), consecutiveFailures: 0 } } });
        await audit({ entityType: 'ItemFamily', entityId: f.id, action: 'cert.family_edited', after: Object.keys(req.body) });
        return { status: 200, body: { id: f.id, status: 'DRAFT' } };
      });
      return reply;
    },
  );

  app.post('/item-families/:id/samples', { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const f = await tx.itemFamily.findFirst({ where: { id: req.params.id, clientId: actor.clientId }, include: { blueprint: true } });
      if (!f) throw notFound('Item family not found');
      const r = await tx.generationRun.create({ data: { clientId: f.clientId, versionId: f.blueprint.versionId, scope: 'SAMPLE', target: { familyId: f.id }, createdById: actor.userId } });
      await tx.outboxEvent.create({ data: { clientId: f.clientId, name: 'guidelines.generate', aggregateType: 'GenerationRun', aggregateId: r.id, payload: { runId: r.id } } });
      await audit({ entityType: 'ItemFamily', entityId: f.id, action: 'cert.sample_requested', after: { runId: r.id } });
      return { status: 202, body: { runId: r.id } };
    });
    return reply;
  });

  // Every family is approved by an Admin, with samples. The Expert tier also needs a Validator (until the domain has two
  // certified Experts) or a certified Expert (candidate app) before it is approved.
  app.post('/item-families/:id/decision', { config: { access: REVIEW }, schema: { tags: ['cert'], params: IdParams, body: z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(1000).default('') }) } }, async (req, reply) => {
    await runCommand<{ id: string; status: string; approvals: unknown }>(db, req, reply, async ({ tx, actor, audit }) => {
      const f = await tx.itemFamily.findFirst({ where: { id: req.params.id, clientId: actor.clientId }, include: { blueprint: { include: { version: { include: { package: true } } } } } });
      if (!f) throw notFound('Item family not found');
      if (f.status === 'FLAGGED' && req.body.decision === 'APPROVE') throw new AppError(409, 'FAMILY_FLAGGED', 'This family was flagged after repeated validation failures; edit or regenerate it first.');
      if (req.body.decision === 'REJECT') {
        if (!actor.roles.includes('ADMIN')) throw new AppError(403, 'ADMIN_ONLY', 'Only an Admin rejects item families.');
        await tx.itemFamily.update({ where: { id: f.id }, data: { status: 'REJECTED' } });
        await audit({ entityType: 'ItemFamily', entityId: f.id, action: 'cert.family_rejected', after: { note: req.body.note } });
        return { status: 200, body: { id: f.id, status: 'REJECTED', approvals: f.approvals } };
      }
      if (!(await tx.itemInstance.count({ where: { familyId: f.id, status: 'SAMPLE' } }))) throw new AppError(409, 'NO_SAMPLES', 'Generate at least one valid sample before approving.');
      const role = actor.roles.includes('ADMIN') ? 'ADMIN' : 'REVIEWER';
      const approvals = [...((f.approvals as { userId: string; role: string }[]) ?? []).filter((a) => a.userId !== actor.userId), { userId: actor.userId, role, at: new Date().toISOString() }];
      let approved = approvals.some((a) => a.role === 'ADMIN');
      if (f.blueprint.tier === 'EXPERT') {
        const experts = await tx.certification.count({ where: { domain: f.blueprint.version.package.domain, tier: 'EXPERT', state: 'PASSED' } });
        approved = approved && (experts >= 2 ? approvals.some((a) => a.role === 'EXPERT') : approvals.some((a) => a.role === 'REVIEWER'));
      }
      await tx.itemFamily.update({ where: { id: f.id }, data: { approvals: approvals as Prisma.InputJsonValue, status: approved ? 'APPROVED' : 'DRAFT' } });
      await audit({ entityType: 'ItemFamily', entityId: f.id, action: approved ? 'cert.family_approved' : 'cert.family_approval_recorded', after: { role, approvals: approvals.length, note: req.body.note } });
      return { status: 200, body: { id: f.id, status: approved ? 'APPROVED' : 'DRAFT', approvals } };
    });
    return reply;
  });

  app.post('/guidelines/versions/:id/tiers/:tier/publish', { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams.extend({ tier: z.enum(SME_TIERS) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const v = await tx.guidelinesVersion.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!v) throw notFound('Version not found');
      const course = await tx.course.findUnique({ where: { versionId_tier: { versionId: v.id, tier: req.params.tier } } });
      const bp = await tx.certificationBlueprint.findUnique({ where: { versionId_tier: { versionId: v.id, tier: req.params.tier } }, include: { families: true } });
      const comps = (bp?.competencies ?? []) as { key: string }[];
      const approved = bp?.families.filter((f) => f.status === 'APPROVED') ?? [];
      const missing = [
        ...(course?.status === 'APPROVED' ? [] : ['the course']),
        ...(bp?.status === 'APPROVED' ? [] : ['the blueprint']),
        ...comps.filter((c) => !approved.some((f) => f.competency === c.key && f.itemType !== 'AUTHORING')).map((c) => `an approved item family for "${c.key}"`),
        ...(bp?.authoringTask && !approved.some((f) => f.itemType === 'AUTHORING') ? ['an approved authoring-task family'] : []),
      ];
      if (missing.length) throw new AppError(409, 'NOT_READY_TO_PUBLISH', `Approve ${missing.join(', ')} before publishing.`, { missing });
      const u = await tx.guidelinesVersion.update({ where: { id: v.id }, data: { publishedTiers: [...new Set([...v.publishedTiers, req.params.tier])], status: 'PUBLISHED' } });
      await audit({ entityType: 'GuidelinesVersion', entityId: v.id, action: 'cert.tier_published', after: { tier: req.params.tier, version: v.version } });
      return { status: 200, body: { id: u.id, publishedTiers: u.publishedTiers, status: u.status } };
    });
    return reply;
  });

  // ── Link a requisition to its guidelines package ──
  app.put('/requisitions/:id/guidelines', { config: { access: ['ADMIN', 'PM'] }, schema: { tags: ['cert'], params: IdParams, body: z.object({ packageId: z.string().uuid(), version: z.number().int().min(1).nullable().default(null) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const r = await tx.requisition.findFirst({ where: { id: req.params.id, clientId: actor.clientId }, include: { project: true } });
      if (!r || (!actor.roles.includes('ADMIN') && r.project.ownerId !== actor.userId)) throw notFound('Requisition not found');
      const p = await tx.guidelinesPackage.findFirst({ where: { id: req.body.packageId, clientId: actor.clientId } });
      if (!p) throw notFound('Guidelines package not found');
      if (p.domain !== r.domain) throw new AppError(422, 'DOMAIN_MISMATCH', 'The guidelines package is for another domain.');
      await tx.requisition.update({ where: { id: r.id }, data: { guidelinesPackageId: p.id, guidelinesVersion: req.body.version } });
      await audit({ entityType: 'Requisition', entityId: r.id, action: 'requisition.guidelines_linked', after: { packageId: p.id, version: req.body.version } });
      return { status: 200, body: { requisitionId: r.id, packageId: p.id, version: req.body.version } };
    });
    return reply;
  });

  // ── Certification review queue (written answers, failures, licences) ──
  app.get('/certifications/review-queue', { config: { access: REVIEW }, schema: { tags: ['cert'] } }, async (req) => {
    const clientId = req.actor!.clientId;
    const attempts = await db.testAttempt.findMany({ where: { clientId, status: 'NEEDS_REVIEW' }, include: { certification: true }, orderBy: { submittedAt: 'asc' } });
    const certs = await db.certification.findMany({ where: { clientId, OR: [{ state: 'REVIEW_REQUIRED' }, { licenceStatus: 'PENDING' }] }, orderBy: { updatedAt: 'asc' } });
    const itemIds = attempts.flatMap((a) => Object.entries(a.grading as Record<string, { written?: boolean }>).filter(([, g]) => g.written).map(([id]) => id));
    const items = new Map((await db.itemInstance.findMany({ where: { id: { in: itemIds } }, include: { family: { select: { itemType: true } } } })).map((i) => [i.id, i]));
    return {
      grading: attempts.map((a) => ({
        attemptId: a.id,
        certificationId: a.certificationId,
        tier: a.certification.tier,
        domain: a.certification.domain,
        submittedAt: a.submittedAt?.toISOString() ?? null,
        items: Object.entries(a.grading as Record<string, { written?: boolean; recommendation?: unknown; confirmations?: unknown[]; required?: number }>)
          .filter(([, g]) => g.written)
          .map(([id, g]) => ({ itemId: id, itemType: items.get(id)?.family.itemType, stem: items.get(id)?.stem, rubric: (items.get(id)?.content as { rubric?: unknown })?.rubric ?? [], answer: (a.answers as Record<string, unknown>)[id] ?? '', recommendation: g.recommendation, confirmations: g.confirmations ?? [], required: g.required ?? 1 })),
      })),
      certifications: certs.map((c) => ({ id: c.id, smeUserId: c.smeUserId, tier: c.tier, domain: c.domain, state: c.state, reviewReason: c.reviewReason, attemptsUsed: c.attemptsUsed, licenceStatus: c.licenceStatus, licence: c.licence })),
    };
  });

  app.post('/test-attempts/:id/grades', { config: { access: REVIEW }, schema: { tags: ['cert'], params: IdParams, body: z.object({ itemId: z.string().uuid(), score: z.number().min(0).max(1) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const a = await tx.testAttempt.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!a) throw notFound('Test not found');
      const r = await confirmGrade(tx, { attemptId: a.id, itemId: req.body.itemId, score: req.body.score, confirmer: { kind: 'INTERNAL', userId: actor.userId, roles: actor.roles } });
      await audit({ entityType: 'TestAttempt', entityId: a.id, action: 'cert.grade_confirmed', after: { itemId: req.body.itemId, score: req.body.score, confirmations: r.confirmations, required: r.required } });
      await finalizeTx(tx, a.id);
      return { status: 200, body: r };
    });
    return reply;
  });

  app.post('/certifications/:id/decision', { config: { access: REVIEW }, schema: { tags: ['cert'], params: IdParams, body: z.object({ decision: z.enum(['CERTIFY', 'NOT_CERTIFIED', 'ALLOW_RETAKE']), reason: z.string().trim().min(5).max(2000) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const c = await tx.certification.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!c) throw notFound('Certification not found');
      const u = await decideCertification(tx, c, req.body.decision, req.body.reason, actor.userId);
      await audit({ entityType: 'Certification', entityId: c.id, action: `cert.decision_${req.body.decision.toLowerCase()}`, before: { state: c.state }, after: { state: u.state, reason: req.body.reason } });
      return { status: 200, body: { id: u.id, state: u.state } };
    });
    return reply;
  });

  app.post('/certifications/:id/licence-decision', { config: { access: REVIEW }, schema: { tags: ['cert'], params: IdParams, body: z.object({ confirm: z.boolean(), note: z.string().trim().min(3).max(1000) }) } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const c = await tx.certification.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
      if (!c) throw notFound('Certification not found');
      const u = await decideLicence(tx, c, req.body.confirm, req.body.note, actor.userId, audit);
      return { status: 200, body: { id: u.id, state: u.state, licenceStatus: u.licenceStatus } };
    });
    return reply;
  });

  app.get('/certifications/:id/licence-file', { config: { access: REVIEW }, schema: { tags: ['cert'], params: IdParams } }, async (req, reply) => {
    const c = await db.certification.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId } });
    const l = c?.licence as { storageKey?: string; fileName?: string } | null;
    if (!c || !l?.storageKey) throw notFound('Licence not found');
    await db.auditEvent.create({ data: { clientId: c.clientId, actorType: 'USER', actorId: req.actor!.userId, entityType: 'Certification', entityId: c.id, action: 'cert.licence_opened' } });
    return reply.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="${(l.fileName ?? 'licence').replace(/"/g, '')}"`).header('cache-control', 'private, no-store').send(await storage.get(l.storageKey));
  });

  // ── SME standing (human-approved changes; history kept) ──
  app.post(
    '/sme/:id/standing',
    { config: { access: ADMIN }, schema: { tags: ['cert'], params: IdParams, body: z.object({ domain: z.string().trim().min(2).max(60), tier: z.enum(SME_TIERS), standing: z.enum(['PROBATION', 'ACTIVE', 'RETRAINING', 'SUSPENDED', 'OFFBOARDED']), reason: z.string().trim().min(5).max(2000) }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const u = await tx.smeUser.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
        if (!u) throw notFound('SME not found');
        const before = await tx.smeStanding.findFirst({ where: { smeUserId: u.id, domain: req.body.domain }, orderBy: { createdAt: 'desc' } });
        const row = await tx.smeStanding.create({ data: { clientId: actor.clientId, smeUserId: u.id, domain: req.body.domain, tier: req.body.tier, standing: req.body.standing, reason: req.body.reason, approvedById: actor.userId } });
        await audit({ entityType: 'SmeStanding', entityId: row.id, action: 'sme.standing_changed', before: before ? { tier: before.tier, standing: before.standing } : undefined, after: { tier: row.tier, standing: row.standing, reason: row.reason } });
        const cand = await tx.supplyCandidate.findUnique({ where: { smeUserId: u.id }, include: { submissions: { where: { sandbox: false, state: 'INVITED' } } } });
        const type = row.standing === 'SUSPENDED' ? 'sme.suspended' : row.standing === 'OFFBOARDED' ? 'sme.offboarded' : before && before.tier !== row.tier ? 'sme.tier_changed' : null;
        for (const s of cand?.submissions ?? []) {
          if (type) await notifyPartner(tx, { partnerId: s.partnerId, sandbox: false, type, data: { candidateId: s.id, domain: row.domain, tier: row.tier, standing: row.standing } });
        }
        return { status: 201, body: { id: row.id, standing: row.standing, tier: row.tier } };
      });
      return reply;
    },
  );
};

export { notifyCertification };
