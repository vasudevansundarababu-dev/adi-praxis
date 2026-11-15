import { PolicyRuleBody, RuleAnnotationInput } from '@praxis/shared';
import type { ObjectStorage } from '../candidate/storage';
import type { Db } from '../db';
import type { EventHandler } from '../outbox/handlers';
import { caseSelectorOf } from '../tasks/task-service';
import { annotationState, editorRole, nextAnnotationVersion, recordRevision, revisionsForRules } from './annotations';
import { loadVersionText } from './documents';
import { resolveCitation } from './extraction/normalise';
import { ANNOTATION_PROMPT_VERSION, RuleAssistantUnavailableError, type AnnotateRule, type PolicyRuleAssistant } from './rule-assistant';
import { currentVersions, editRule } from './rules';

/**
 * The AI annotation pass (plan §4). Runs in the worker after every extraction, and when a PM/Admin asks for it on a
 * document ("Suggest annotations"). The model is called outside any transaction. Each result is stored as an
 * AI_SUGGESTION revision. It becomes the rule's annotation only on a draft whose annotation is absent or itself an
 * unedited AI suggestion; on an applied rule, or one an author has annotated, it is only offered. The AI never
 * applies, reviews, excludes or publishes anything.
 */

export const ANNOTATION_ACTIONS = { requested: 'policy.rule_annotations_requested', suggested: 'policy.rule_annotations_suggested', failed: 'policy.rule_annotations_failed', skipped: 'policy.rule_annotations_skipped' } as const;

export interface AnnotateRequest {
  clientId: string;
  projectId: string;
  documentId: string;
  /** Audit run ID (the request's outbox aggregate) so the page can follow the run. */
  runId: string;
  requestedById: string;
  requestedRoles: string[];
  trigger: 'extraction' | 'manual';
  /** Only these rules (Define with AI on one rule); absent = every rule of the document. */
  ruleKeys?: string[];
}

/** AI runs today for this tenant (the existing per-tenant daily cap counts runs, not model calls). */
export async function aiRunsToday(db: Db, clientId: string, actions: string[]) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  return db.auditEvent.count({ where: { clientId, action: { in: actions }, createdAt: { gte: since } } });
}

export async function annotateDocument(db: Db, deps: { storage: ObjectStorage; assistant: PolicyRuleAssistant; dailyCap: number; capActions: string[] }, req: AnnotateRequest) {
  const audit = (action: string, after: Record<string, unknown>) =>
    db.auditEvent.create({ data: { clientId: req.clientId, actorType: req.trigger === 'manual' ? 'USER' : 'SYSTEM', actorId: req.trigger === 'manual' ? req.requestedById : 'policy-annotation', entityType: 'PolicyDocument', entityId: req.documentId, action, after: { runId: req.runId, trigger: req.trigger, ...after } as object } });
  // Idempotent per run: a redelivered event for a finished run does nothing.
  const done = await db.auditEvent.findFirst({ where: { clientId: req.clientId, entityType: 'PolicyDocument', entityId: req.documentId, action: { in: [ANNOTATION_ACTIONS.suggested, ANNOTATION_ACTIONS.skipped] }, after: { path: ['runId'], equals: req.runId } }, select: { id: true } });
  if (done) return { status: 'done' as const, annotated: 0, offered: 0 };
  if ((await aiRunsToday(db, req.clientId, deps.capActions)) >= deps.dailyCap) {
    await audit(ANNOTATION_ACTIONS.skipped, { reason: 'MODEL_DAILY_CAP' });
    return { status: 'skipped' as const, annotated: 0, offered: 0 };
  }

  const project = await db.project.findFirstOrThrow({ where: { id: req.projectId, clientId: req.clientId }, select: { templateId: true } });
  const template = await db.template.findUnique({ where: { id: project.templateId }, select: { caseSelector: true } });
  const applicationTypes = caseSelectorOf(template?.caseSelector)?.values ?? [];
  const items = (await currentVersions(db, req.clientId, req.projectId)).filter((r) => r.version.citations.some((c) => c.documentVersion.documentId === req.documentId) && (!req.ruleKeys || req.ruleKeys.includes(r.rule.ruleKey)));
  if (!items.length) {
    await audit(ANNOTATION_ACTIONS.suggested, { model: deps.assistant.modelVersion, rules: 0, annotated: 0, offered: 0 });
    return { status: 'done' as const, annotated: 0, offered: 0 };
  }
  const dv = items.flatMap((r) => r.version.citations.map((c) => c.documentVersion)).filter((d) => d.documentId === req.documentId).sort((a, b) => b.version - a.version)[0]!;
  const doc = await loadVersionText(deps.storage, dv);
  const rules: AnnotateRule[] = items.map((r) => {
    const b = PolicyRuleBody.parse(r.version.body);
    const quotes = [...r.version.citations].sort((x, y) => (x.fieldPath === 'requirement' ? -1 : y.fieldPath === 'requirement' ? 1 : 0)).map((c) => c.quote);
    return { ruleKey: r.rule.ruleKey, title: b.title, requirement: b.requirement, quotes, conditionText: b.applicability.conditionText, jurisdictions: b.applicability.jurisdictions, exceptions: b.exceptions.items.map((e) => e.statement) };
  });

  let suggestions;
  try {
    suggestions = await deps.assistant.annotate({ documentTitle: dv.document.title, documentText: doc.text, rules, applicationTypes });
  } catch (e) {
    await audit(ANNOTATION_ACTIONS.failed, { model: deps.assistant.modelVersion, error: e instanceof RuleAssistantUnavailableError ? e.message.slice(0, 300) : 'Annotation failed unexpectedly.' });
    if (e instanceof RuleAssistantUnavailableError) return { status: 'failed' as const, annotated: 0, offered: 0 };
    throw e;
  }

  const byKey = new Map(items.map((r) => [r.rule.ruleKey, r]));
  const revisions = await revisionsForRules(db, req.clientId, items.map((r) => r.rule.id));
  let annotated = 0;
  let offered = 0;
  let droppedStatements = 0;
  for (const s of suggestions) {
    const item = byKey.get(s.ruleKey);
    if (!item) continue;
    let annotation = RuleAnnotationInput.parse(s.annotation);
    // A compound's original statement must be found word for word in the document; otherwise it is dropped.
    if (annotation.compound && resolveCitation({ fieldPath: 'requirement', role: 'supports', quote: annotation.compound.originalStatement, page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: null }, { ...doc, format: dv.format }).resolution !== 'RESOLVED') {
      annotation = { ...annotation, compound: null };
      droppedStatements++;
    }
    const save = { source: 'AI_SUGGESTION' as const, editedById: req.requestedById, editedRole: editorRole(req.requestedRoles), model: deps.assistant.modelVersion, promptVersion: ANNOTATION_PROMPT_VERSION };
    const outcome = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PolicyRule" WHERE id = ${item.rule.id}::uuid FOR UPDATE`;
      const latest = await tx.policyRuleVersion.findFirstOrThrow({ where: { ruleId: item.rule.id }, orderBy: { version: 'desc' } });
      const body = PolicyRuleBody.parse(latest.body);
      const { current } = annotationState(body, revisions.filter((r) => r.ruleId === item.rule.id));
      const editable = latest.state === 'DRAFT' || latest.state === 'NEEDS_DEFINITION';
      const adopt = editable && (!body.annotation || current?.source === 'AI_SUGGESTION');
      if (adopt) {
        await editRule(tx, { loadText: (v) => loadVersionText(deps.storage, v) }, { clientId: req.clientId, projectId: req.projectId, ruleId: item.rule.id, actorId: req.requestedById, expectedContentHash: latest.contentHash, body: { ...body, annotation: { ...annotation, version: 1 } }, annotationSave: save }, async (a) => {
          await tx.auditEvent.create({ data: { clientId: req.clientId, actorType: 'SYSTEM', actorId: 'policy-annotation', entityType: a.entityType, entityId: a.entityId, action: a.action, before: (a.before ?? undefined) as object | undefined, after: (a.after ?? undefined) as object | undefined } });
        });
        return 'annotated';
      }
      await recordRevision(tx, { clientId: req.clientId, ruleId: item.rule.id, ruleVersionId: latest.id, annotation: { ...annotation, version: await nextAnnotationVersion(tx, item.rule.id) }, adopted: false, save });
      return 'offered';
    });
    if (outcome === 'annotated') annotated++;
    else offered++;
  }
  await audit(ANNOTATION_ACTIONS.suggested, { model: deps.assistant.modelVersion, promptVersion: ANNOTATION_PROMPT_VERSION, rules: rules.length, annotated, offered, droppedStatements, documentVersionId: dv.id });
  return { status: 'done' as const, annotated, offered };
}

/** Worker handler for `policy.annotation_requested` (after extraction, or a PM/Admin request). */
export function policyAnnotationHandler(deps: { storage: ObjectStorage; assistant: PolicyRuleAssistant; dailyCap: number; capActions: string[] }): EventHandler {
  return {
    name: 'policy.annotate',
    event: 'policy.annotation_requested',
    run: async (e, db) => {
      const p = e.payload as Omit<AnnotateRequest, 'runId'>;
      await annotateDocument(db, deps, { ...p, runId: e.aggregateId });
    },
  };
}
