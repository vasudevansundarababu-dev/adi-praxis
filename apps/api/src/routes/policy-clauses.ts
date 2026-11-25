import { ClauseCondition, FactCatalog, PolicyRuleBody } from '@praxis/shared';
import type { ObjectStorage } from '../candidate/storage';
import { aiFailureKind, aiUnavailableMessage } from '../lib/ai-errors';
import { notFound } from '../lib/errors';
import { checkedDispositions, DISPOSITION_PROMPT_VERSION, DispositionUnavailableError, type DispositionSuggester } from '../policy/dispositions';
import { evaluateQuality, ReferenceLabel, ReferenceSetBody } from '../policy/quality';
import { editRule, setApplied } from '../policy/rules';
import { projectFlags, reviewQueue } from '../policy/review-queue';
import type { StudioCoverageClient } from '../anvil/coverage-client';
import { loadVersionText } from '../policy/documents';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { AppError } from '../lib/errors';
import { runCommand } from '../platform/command';
import { POLICY_ACCESS, policyProject } from '../policy/access';
import { approvedClauses, catalogFromTemplate, conditionCatalog, projectFactCatalog, templateBoundFacts } from '../policy/fact-catalog';
import { adoptedBody, storeSuggestion } from '../policy/suggestions';
import { jcsSha256 } from '../anvil/jcs';
import { ownTask } from './work';

/**
 * E-002 §4.1 (owner decisions 23 Nov 2026): the project scope's fact catalog, the approved clause versions with their
 * conditions in plain language, and the S4 clause list for an SME's task ("setup needed" when the template does not bind
 * a fact the condition needs; shown, never hidden). The SME selects clauses; only the PM approves conditions.
 */
const ProjectParams = z.object({ projectId: z.string().uuid() });

export const policyClauseRoutes: FastifyPluginAsyncZod<{ db: Db; storage: ObjectStorage; dispositions: DispositionSuggester; coverage?: StudioCoverageClient | null }> = async (app, { db, storage, dispositions, coverage = null }) => {
  const loadText = (v: { textStorageKey: string }) => loadVersionText(storage, v);

  // ── E-002 §1.3: suggested dispositions (never approvals). Manual review stays available when the AI fails. ──
  app.post('/projects/:projectId/policy/dispositions', { config: { access: POLICY_ACCESS, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['policy'], params: ProjectParams, body: z.object({ scope: z.string().trim().max(2000).optional() }).strict() } }, async (req, reply) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id }, include: { template: true } });
    // KYC Judgment v1 A1: conditions may name the derived facts the project's rules define.
    const catalog = await conditionCatalog(db, p.id);
    const rules = await db.policyRule.findMany({ where: { clientId: req.actor!.clientId, projectId: p.id }, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { citations: true } } }, orderBy: { ruleKey: 'asc' } });
    const input = rules.flatMap((r) => {
      const v = r.versions[0];
      if (!v) return [];
      const b = PolicyRuleBody.parse(v.body);
      return [{ ruleKey: r.ruleKey, title: b.title, requirement: b.requirement, applicability: b.applicability.conditionText ?? null, jurisdictions: b.applicability.jurisdictions ?? [], quotes: v.citations.map((c) => c.quote) }];
    });
    if (!input.length) return { model: dispositions.modelVersion, items: [] };
    let raw: unknown[];
    try {
      raw = await dispositions.suggest({ scope: req.body.scope ?? project.name, catalog, rules: input });
    } catch (err) {
      if (err instanceof DispositionUnavailableError) throw new AppError(503, 'DISPOSITIONS_UNAVAILABLE', aiUnavailableMessage(err, 'Suggestions', 'You can review each rule by hand.', 'Suggestions are not available right now. You can review each rule by hand.'), { reason: aiFailureKind(err) });
      throw err;
    }
    const bound = templateBoundFacts(project.template.anvilSpec);
    const checked = checkedDispositions(raw, input, catalog, bound?.facts ?? null);
    // KYC Judgment v1 A1: each suggestion is stored once against the exact rule version it was made for (never applied).
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const items = [];
      for (const d of checked) {
        const r = rules.find((x) => x.ruleKey === d.ruleKey)!;
        const v = r.versions[0]!;
        const row = await storeSuggestion(tx, { clientId: actor.clientId, projectId: p.id, ruleId: r.id, ruleVersionId: v.id, contentHash: v.contentHash, source: 'disposition', model: dispositions.modelVersion, promptVersion: DISPOSITION_PROMPT_VERSION, content: (({ ruleKey: _k, ...rest }) => rest)(d), problems: [], createdById: actor.userId });
        items.push({ ...d, ruleId: r.id, contentHash: v.contentHash, suggestionId: row.id });
      }
      await audit({ entityType: 'Project', entityId: p.id, action: 'policy.dispositions_suggested', after: { model: dispositions.modelVersion, promptVersion: DISPOSITION_PROMPT_VERSION, items: items.length } });
      return { status: 200, body: { model: dispositions.modelVersion, items } };
    });
    return reply;
  });

  // ── KYC Judgment v1 A3: the PM's review queue, Studio's coverage on draft conditions, and bulk confirm ──
  app.get('/projects/:projectId/policy/review-queue', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const items = await reviewQueue(db, req.actor!.clientId, p.id);
    return { items, projectFlags: await projectFlags(db, p.id), flagged: items.filter((i) => i.flags.length).length, total: items.length, studioConnected: !!coverage };
  });

  app.post('/projects/:projectId/policy/review-queue/coverage', { config: { access: POLICY_ACCESS, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['policy'], params: ProjectParams, body: z.object({}).strict() } }, async (req, reply) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    if (!coverage) return reply.status(200).send({ connected: false, checked: 0, stored: 0, message: 'Studio is not connected here, so coverage can’t be checked. The queue still shows every other flag.' });
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id }, include: { template: true } });
    const items = (await reviewQueue(db, req.actor!.clientId, p.id)).filter((i) => i.conditionSet && i.condition !== null);
    const clauses = items.map((i) => ({ clause_id: i.ruleKey, version: i.version, condition: i.condition }));
    if (!clauses.length) return reply.status(200).send({ connected: true, checked: 0, stored: 0 });
    const r = await coverage.check({ template: { id: project.template.lineageId, version: project.template.version }, edge_case_tags: [], edge_cases: [], clauses });
    if (!r.ok) throw new AppError(502, 'COVERAGE_UNAVAILABLE', r.message);
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      let stored = 0;
      for (const c of r.result.clauses) {
        const i = items.find((x) => x.ruleKey === c.clause_id && x.version === c.version);
        if (!i) continue;
        await tx.policyCoverageResult.create({ data: { clientId: actor.clientId, projectId: p.id, ruleId: i.ruleId, ruleVersionId: i.versionId, contentHash: i.contentHash, environmentVersionId: r.result.environment_version_id, status: c.status, gaps: c.gaps as object[], checkedAt: new Date(r.result.checked_at), createdById: actor.userId } });
        stored++;
      }
      await audit({ entityType: 'Project', entityId: p.id, action: 'policy.coverage_checked', after: { environmentVersionId: r.result.environment_version_id, checked: clauses.length, stored } });
      return { status: 200, body: { connected: true, checked: clauses.length, stored, environmentVersionId: r.result.environment_version_id } };
    });
    return reply;
  });

  const BatchBody = z.object({ items: z.array(z.object({ ruleId: z.string().uuid(), expectedContentHash: z.string().length(64) }).strict()).min(1).max(200) }).strict();
  app.post('/projects/:projectId/policy/rules/apply-batch', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams, body: BatchBody } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      // The server recomputes the queue: any rule that is not a draft, changed since, or carries a flag refuses the batch.
      const queue = await reviewQueue(tx, actor.clientId, p.id);
      const refused: { ruleId: string; reason: string }[] = [];
      for (const it of req.body.items) {
        const row = queue.find((q) => q.ruleId === it.ruleId);
        if (!row) refused.push({ ruleId: it.ruleId, reason: 'Not a draft in this project’s review queue.' });
        else if (row.contentHash !== it.expectedContentHash) refused.push({ ruleId: it.ruleId, reason: `${row.ruleKey} changed since you opened the queue. Reload it.` });
        else if (row.flags.length) refused.push({ ruleId: it.ruleId, reason: `${row.ruleKey} is flagged (${row.flags.map((f) => f.code).join(', ')}): open it and review it on its own.` });
      }
      if (refused.length) throw new AppError(409, 'BATCH_REFUSED', `Nothing was applied: ${refused.length} of ${req.body.items.length} rules can't be confirmed in a batch. ${refused.map((r) => r.reason).join(' ')}`, { refused });
      const versions = [];
      for (const it of req.body.items) {
        const out = await setApplied(tx, { clientId: actor.clientId, projectId: p.id, ruleId: it.ruleId, actorId: actor.userId, roles: actor.roles, applied: true, expectedContentHash: it.expectedContentHash }, audit);
        versions.push({ ruleId: it.ruleId, versionId: out.version.id, version: out.version.version, contentHash: out.version.contentHash });
      }
      await audit({ entityType: 'Project', entityId: p.id, action: 'policy.rules_applied_batch', after: { applied: versions.length, ruleIds: versions.map((v) => v.ruleId) } });
      return { status: 200, body: { applied: versions.length, versions } };
    });
    return reply;
  });

  // ── KYC Judgment v1 A1: stored suggestions of a rule, and the PM adopting one (an ordinary, audited rule edit) ──
  app.get('/projects/:projectId/policy/rules/:ruleId/suggestions', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ ruleId: z.string().uuid() }) } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const latest = await db.policyRuleVersion.findFirst({ where: { ruleId: req.params.ruleId, clientId: req.actor!.clientId, rule: { projectId: p.id } }, orderBy: { version: 'desc' } });
    if (!latest) throw notFound('Rule not found');
    const rows = await db.policyRuleSuggestion.findMany({ where: { ruleId: req.params.ruleId, projectId: p.id }, orderBy: { createdAt: 'desc' } });
    return { items: rows.map((s) => ({ id: s.id, source: s.source, model: s.model, promptVersion: s.promptVersion, ruleVersionId: s.ruleVersionId, contentHash: s.contentHash, content: s.content, problems: s.problems, current: s.ruleVersionId === latest.id && s.contentHash === latest.contentHash, at: s.createdAt.toISOString() })) };
  });

  app.post('/projects/:projectId/policy/suggestions/:suggestionId/adopt', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ suggestionId: z.string().uuid() }), body: z.object({ expectedContentHash: z.string().length(64) }).strict() } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const s = await tx.policyRuleSuggestion.findFirst({ where: { id: req.params.suggestionId, projectId: p.id, clientId: actor.clientId } });
      if (!s) throw notFound('Suggestion not found');
      const cur = await tx.policyRuleVersion.findFirstOrThrow({ where: { ruleId: s.ruleId }, orderBy: { version: 'desc' } });
      if (cur.id !== s.ruleVersionId || cur.contentHash !== s.contentHash) throw new AppError(409, 'STALE_SUGGESTION', 'This suggestion was made for an earlier version of the rule. Ask for a new suggestion, or edit the rule by hand.');
      const problems = Array.isArray(s.problems) ? (s.problems as string[]) : [];
      if (problems.length) throw new AppError(422, 'SUGGESTION_HAS_PROBLEMS', `This suggestion did not pass the checks, so it can't be adopted: ${problems.join(' ')}`, { problems });
      const { body, parts } = adoptedBody(PolicyRuleBody.parse(cur.body), s.content);
      if (!parts.length) throw new AppError(422, 'NOTHING_TO_ADOPT', 'This suggestion asks a question; it has no condition or library details to adopt. Answer it by editing the rule.');
      const out = await editRule(tx, { loadText }, { clientId: actor.clientId, projectId: p.id, ruleId: s.ruleId, actorId: actor.userId, expectedContentHash: req.body.expectedContentHash, body }, audit);
      await audit({ entityType: 'PolicyRuleVersion', entityId: out.id, action: 'policy.rule_suggestion_adopted', after: { suggestionId: s.id, source: s.source, model: s.model, parts, version: out.version, contentHash: out.contentHash } });
      return { status: 200, body: { versionId: out.id, version: out.version, state: out.state, contentHash: out.contentHash, adopted: parts } };
    });
    return reply;
  });

  // ── E-002 §4.1.4: PM-only quality evaluation (private reference labels; reproducible runs) ──
  app.put('/projects/:projectId/policy/reference-sets', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams, body: ReferenceSetBody } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const dv = await tx.policyDocumentVersion.findFirst({ where: { id: req.body.documentVersionId, projectId: p.id, clientId: actor.clientId } });
      if (!dv) throw notFound('Document version not found');
      const latest = await tx.policyReferenceSet.findFirst({ where: { documentVersionId: dv.id }, orderBy: { version: 'desc' } });
      const row = await tx.policyReferenceSet.create({ data: { clientId: actor.clientId, projectId: p.id, documentVersionId: dv.id, version: (latest?.version ?? 0) + 1, labels: req.body.labels, createdById: actor.userId } });
      await audit({ entityType: 'PolicyReferenceSet', entityId: row.id, action: 'policy.reference_set_saved', after: { documentVersionId: dv.id, version: row.version, labels: req.body.labels.length } });
      return { status: 201, body: { id: row.id, version: row.version } };
    });
    return reply;
  });

  app.get('/projects/:projectId/policy/quality', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const sets = await db.policyReferenceSet.findMany({ where: { projectId: p.id }, orderBy: [{ documentVersionId: 'asc' }, { version: 'desc' }] });
    const runs = await db.policyQualityRun.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' }, take: 20 });
    return { referenceSets: sets.map((r) => ({ id: r.id, documentVersionId: r.documentVersionId, version: r.version, labels: (r.labels as unknown[]).length, at: r.createdAt.toISOString() })), runs: runs.map((r) => ({ id: r.id, referenceSetId: r.referenceSetId, at: r.createdAt.toISOString(), result: r.result, metadata: r.metadata })) };
  });

  app.post('/projects/:projectId/policy/quality-runs', { config: { access: POLICY_ACCESS, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['policy'], params: ProjectParams, body: z.object({ referenceSetId: z.string().uuid(), includeSuggestions: z.boolean().default(true) }).strict() } }, async (req, reply) => {
    const actor = req.actor!;
    const p = await policyProject(db, actor, req.params.projectId);
    const set = await db.policyReferenceSet.findFirst({ where: { id: req.body.referenceSetId, projectId: p.id } });
    if (!set) throw notFound('Reference set not found');
    const dv = await db.policyDocumentVersion.findUniqueOrThrow({ where: { id: set.documentVersionId } });
    const labels = ReferenceLabel.array().parse(set.labels);
    const rules = await db.policyRule.findMany({ where: { projectId: p.id, clientId: actor.clientId, versions: { some: { citations: { some: { documentVersionId: dv.id } } } } }, include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { citations: true } } } });
    const evaluated = rules.flatMap((r) => (r.versions[0] ? [{ ruleKey: r.ruleKey, quotes: r.versions[0].citations.filter((c) => c.documentVersionId === dv.id).map((c) => c.quote), body: PolicyRuleBody.parse(r.versions[0].body) }] : []));
    let suggestionsBy = new Map<string, string>();
    let suggestionModel: string | null = null;
    const catalog = await projectFactCatalog(db, p.id);
    if (req.body.includeSuggestions && evaluated.length) {
      const project = await db.project.findUniqueOrThrow({ where: { id: p.id }, include: { template: true } });
      const input = evaluated.map((e) => ({ ruleKey: e.ruleKey, title: e.body.title, requirement: e.body.requirement, applicability: e.body.applicability.conditionText ?? null, jurisdictions: e.body.applicability.jurisdictions ?? [], quotes: e.quotes }));
      try {
        const raw = await dispositions.suggest({ scope: project.name, catalog, rules: input });
        suggestionsBy = new Map(checkedDispositions(raw, input, catalog, templateBoundFacts(project.template.anvilSpec)?.facts ?? null).map((d) => [d.ruleKey, d.disposition]));
        suggestionModel = dispositions.modelVersion;
      } catch (err) {
        if (err instanceof DispositionUnavailableError) throw new AppError(503, 'DISPOSITIONS_UNAVAILABLE', aiUnavailableMessage(err, 'The quality evaluation', 'Run it without suggestions to evaluate extraction only.', 'Suggestions are not available right now. Run the evaluation without suggestions to evaluate extraction only.'), { reason: aiFailureKind(err) });
        throw err;
      }
    }
    const result = evaluateQuality(labels, evaluated.map((e) => ({ ruleKey: e.ruleKey, quotes: e.quotes, disposition: suggestionsBy.get(e.ruleKey) ?? null })));
    const job = await db.extractionJob.findFirst({ where: { documentVersionId: dv.id }, orderBy: { createdAt: 'desc' }, include: { batch: true } });
    const batch = (job?.batch ?? null) as Record<string, unknown> | null;
    const metadata = {
      document: { documentId: dv.documentId, documentVersion: dv.version, sha256: dv.sha256 },
      scope: { factCatalogVersion: catalog?.version ?? null, projectName: p.name },
      extraction: job ? { provider: job.provider, jobId: job.id, batchId: job.batchId, ...(batch && 'profileId' in batch ? { profileId: batch.profileId } : {}), ...(batch && 'profileRevision' in batch ? { profileRevision: batch.profileRevision } : {}) } : null,
      suggestions: suggestionModel ? { promptVersion: DISPOSITION_PROMPT_VERSION, model: suggestionModel } : null,
      referenceSet: { id: set.id, version: set.version, labels: labels.length },
    };
    await runCommand<unknown>(db, req, reply, async ({ tx, audit }) => {
      const run = await tx.policyQualityRun.create({ data: { clientId: actor.clientId, projectId: p.id, referenceSetId: set.id, result: result as object, metadata: JSON.parse(JSON.stringify(metadata)) as object, createdById: actor.userId } });
      await audit({ entityType: 'PolicyQualityRun', entityId: run.id, action: 'policy.quality_evaluated', after: { referenceSetId: set.id, counts: result.counts } });
      return { status: 201, body: { id: run.id, result, metadata } };
    });
    return reply;
  });

  // The PM's decision: set (or clear) a rule's condition, for example from a suggestion. A new rule version, audited.
  app.post('/projects/:projectId/policy/rules/:ruleId/condition', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ ruleId: z.string().uuid() }), body: z.object({ expectedContentHash: z.string().length(64), condition: ClauseCondition }).strict() } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const cur = await tx.policyRuleVersion.findFirst({ where: { ruleId: req.params.ruleId, clientId: actor.clientId, rule: { projectId: p.id } }, orderBy: { version: 'desc' } });
      if (!cur) throw notFound('Rule not found');
      const body = { ...PolicyRuleBody.parse(cur.body), condition: req.body.condition };
      const out = await editRule(tx, { loadText }, { clientId: actor.clientId, projectId: p.id, ruleId: req.params.ruleId, actorId: actor.userId, expectedContentHash: req.body.expectedContentHash, body }, audit);
      await audit({ entityType: 'PolicyRuleVersion', entityId: out.id, action: 'policy.rule_condition_set', after: { condition: req.body.condition } });
      return { status: 200, body: { versionId: out.id, version: out.version, contentHash: out.contentHash } };
    });
    return reply;
  });

  app.get('/projects/:projectId/policy/fact-catalog', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const row = await db.projectFactCatalog.findFirst({ where: { projectId: p.id }, orderBy: { version: 'desc' } });
    return { catalog: row ? (row.catalog as unknown) : null, version: row?.version ?? null, at: row?.createdAt.toISOString() ?? null };
  });

  // A new version of the project's fact catalog (frozen and versioned; earlier versions stay).
  app.put('/projects/:projectId/policy/fact-catalog', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams, body: FactCatalog } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      // KYC Judgment v1 A1: the environment's own catalog (C2, owner environment_version) may be the project's, as it is.
      if (!(req.body.owner.kind === 'environment_version' || (req.body.owner.kind === 'project_scope' && req.body.owner.id === p.id))) throw new AppError(422, 'NOT_PROJECT_SCOPE', 'A project fact catalog has owner kind project_scope and this project’s ID, or is the environment’s catalog (owner kind environment_version).');
      const latest = await tx.projectFactCatalog.findFirst({ where: { projectId: p.id }, orderBy: { version: 'desc' } });
      const { version: _v, ...content } = req.body;
      if (latest && jcsSha256({ ...(latest.catalog as Record<string, unknown>), version: 0 }) === jcsSha256({ ...content, version: 0 })) {
        await audit({ entityType: 'ProjectFactCatalog', entityId: latest.id, action: 'policy.fact_catalog_unchanged', after: { version: latest.version } });
        return { status: 200, body: { version: latest.version, unchanged: true } };
      }
      const version = (latest?.version ?? 0) + 1;
      const row = await tx.projectFactCatalog.create({ data: { clientId: actor.clientId, projectId: p.id, version, catalog: { ...content, version } as object, createdById: actor.userId } });
      await audit({ entityType: 'ProjectFactCatalog', entityId: row.id, action: 'policy.fact_catalog_saved', after: { version, facts: req.body.facts.map((f) => f.id) } });
      return { status: 201, body: { version } };
    });
    return reply;
  });

  // A first fact catalog from the facts the template binds (E-002 decision 9.1: the template maps project facts to the
  // environment's). Refused when the project already has one: then the PM edits it.
  app.post('/projects/:projectId/policy/fact-catalog/from-template', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      if (await tx.projectFactCatalog.findFirst({ where: { projectId: p.id } })) throw new AppError(409, 'CATALOG_EXISTS', 'This project already has a fact catalog. Edit it instead.');
      const project = await tx.project.findUniqueOrThrow({ where: { id: p.id }, include: { template: true } });
      const catalog = catalogFromTemplate(project.template.anvilSpec, p.id);
      if (!catalog) throw new AppError(422, 'NO_TEMPLATE_FACTS', 'This project’s template does not bind any policy facts yet, so there is nothing to start from. Studio adds them to the template (policy bindings).');
      const row = await tx.projectFactCatalog.create({ data: { clientId: actor.clientId, projectId: p.id, version: 1, catalog: catalog as object, createdById: actor.userId } });
      await audit({ entityType: 'ProjectFactCatalog', entityId: row.id, action: 'policy.fact_catalog_saved', after: { version: 1, facts: catalog.facts.map((f) => f.id), from: 'template' } });
      return { status: 201, body: { version: 1, facts: catalog.facts.map((f) => f.id) } };
    });
    return reply;
  });

  app.get('/projects/:projectId/policy/clauses', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id }, include: { template: true } });
    return { factCatalogVersion: (await projectFactCatalog(db, p.id))?.version ?? null, templateBinds: templateBoundFacts(project.template.anvilSpec), items: await approvedClauses(db, req.actor!.clientId, p.id, project.template.anvilSpec) };
  });

  // The S4 clause list for the SME's own task: approved versions only; the SME selects, never edits a condition.
  app.get('/me/tasks/:id/policy-clauses', { config: { access: 'candidate' }, schema: { tags: ['work'], params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const t = await ownTask(db, req.params.id, req.candidate!.smeUserId);
    const items = await approvedClauses(db, t.clientId, t.projectId, t.project.template.anvilSpec);
    return { items: items.map(({ approval: _a, ...c }) => c) };
  });
};
