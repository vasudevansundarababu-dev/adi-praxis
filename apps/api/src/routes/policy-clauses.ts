import { ClauseCondition, FactCatalog, PolicyRuleBody } from '@praxis/shared';
import type { ObjectStorage } from '../candidate/storage';
import { aiFailureKind, aiUnavailableMessage } from '../lib/ai-errors';
import { notFound } from '../lib/errors';
import { checkedDispositions, DISPOSITION_PROMPT_VERSION, DispositionUnavailableError, type DispositionSuggester } from '../policy/dispositions';
import { evaluateQuality, ReferenceLabel, ReferenceSetBody } from '../policy/quality';
import { editRule } from '../policy/rules';
import { loadVersionText } from '../policy/documents';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db';
import { AppError } from '../lib/errors';
import { runCommand } from '../platform/command';
import { POLICY_ACCESS, policyProject } from '../policy/access';
import { approvedClauses, projectFactCatalog, templateBoundFacts } from '../policy/fact-catalog';
import { jcsSha256 } from '../anvil/jcs';
import { ownTask } from './work';

/**
 * E-002 §4.1 (owner decisions 23 Nov 2026): the project scope's fact catalog, the approved clause versions with their
 * conditions in plain language, and the S4 clause list for an SME's task ("setup needed" when the template does not bind
 * a fact the condition needs; shown, never hidden). The SME selects clauses; only the PM approves conditions.
 */
const ProjectParams = z.object({ projectId: z.string().uuid() });

export const policyClauseRoutes: FastifyPluginAsyncZod<{ db: Db; storage: ObjectStorage; dispositions: DispositionSuggester }> = async (app, { db, storage, dispositions }) => {
  const loadText = (v: { textStorageKey: string }) => loadVersionText(storage, v);

  // ── E-002 §1.3: suggested dispositions (never approvals). Manual review stays available when the AI fails. ──
  app.post('/projects/:projectId/policy/dispositions', { config: { access: POLICY_ACCESS, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['policy'], params: ProjectParams, body: z.object({ scope: z.string().trim().max(2000).optional() }).strict() } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const project = await db.project.findUniqueOrThrow({ where: { id: p.id }, include: { template: true } });
    const catalog = await projectFactCatalog(db, p.id);
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
    return { model: dispositions.modelVersion, items: checked.map((d) => { const r = rules.find((x) => x.ruleKey === d.ruleKey)!; return { ...d, ruleId: r.id, contentHash: r.versions[0]!.contentHash }; }) };
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
      if (req.body.owner.kind !== 'project_scope' || req.body.owner.id !== p.id) throw new AppError(422, 'NOT_PROJECT_SCOPE', 'A project fact catalog has owner kind project_scope and this project’s ID.');
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
