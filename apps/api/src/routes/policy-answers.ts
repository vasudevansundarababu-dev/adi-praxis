import { conditionLabel, PolicyRuleBody, type FactCatalog } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import { aiErrorForLog, aiUnavailableMessage } from '../lib/ai-errors';
import { AppError, conflict, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { POLICY_ACCESS, policyProject } from '../policy/access';
import { ANSWER_FIELDS, ANSWER_PROMPT_VERSION, answerCostUsd, applyChanges, checkedProposal, startOfBudgetDay, StubAnswerFiller, VertexAnswerFiller, type AnswerFiller, type ProposedChange } from '../policy/answers';
import { loadVersionText } from '../policy/documents';
import { conditionCatalog } from '../policy/fact-catalog';
import { policyAiModel } from '../policy/rule-assistant';
import { editRule } from '../policy/rules';

/**
 * Owner and Jose, 27 Nov 2026: answer an open question on the rule page. The answer is stored exactly as typed, with
 * who answered and when (append-only). "Fill from my answer" (the AI answer switch) also asks the policy model for
 * field changes; they are only proposals, shown before → after, and the reviewer accepts each one, which is an
 * ordinary rule edit (a new draft, every check unchanged). The AI answers stop for the day at the budget.
 */
export const ANSWER_ACTIONS = { answered: 'policy.question_answered', accepted: 'policy.answer_changes_accepted' } as const;
const PAUSED = 'AI answers are paused for today (budget reached). Your answer is saved; fill the fields by hand.';

export function defaultAnswerFiller(config: Config): AnswerFiller {
  return config.assistantMode === 'vertex' && config.AI_ANSWER_ENABLED ? new VertexAnswerFiller(policyAiModel(config), { projectId: config.VERTEX_PROJECT_ID, location: config.VERTEX_LOCATION }) : new StubAnswerFiller();
}

/** Today's AI answer spend for a client, in USD. */
export async function answerSpendToday(db: Db | Tx, clientId: string): Promise<number> {
  const r = await db.policyQuestionAnswer.aggregate({ where: { clientId, createdAt: { gte: startOfBudgetDay() } }, _sum: { costUsd: true } });
  return Number(r._sum.costUsd ?? 0);
}

/** The rule page's aids: whether field links and the AI answer are on, and whether today's AI budget is used up. */
export async function ruleAids(db: Db | Tx, config: Config, clientId: string) {
  const spent = config.AI_ANSWER_ENABLED ? await answerSpendToday(db, clientId) : 0;
  return { fieldLinks: config.RULE_FIELD_LINKS_ENABLED, aiAnswer: config.AI_ANSWER_ENABLED, aiPaused: config.AI_ANSWER_ENABLED && spent >= config.AI_ANSWER_DAILY_BUDGET_USD };
}

export interface AnswerDto {
  id: string;
  ruleVersionId: string;
  question: string;
  answer: string;
  answeredBy: string;
  answeredAt: string;
  aiStatus: string;
  aiMessage: string | null;
  changes: ProposedChange[];
  costUsd: number | null;
  accepted: string[];
}

/** Every answer on a rule (newest first), with what the reviewer accepted from each. */
export async function answersFor(db: Db | Tx, clientId: string, ruleId: string): Promise<AnswerDto[]> {
  const rows = await db.policyQuestionAnswer.findMany({ where: { clientId, ruleId }, orderBy: { createdAt: 'desc' }, take: 50 });
  if (!rows.length) return [];
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.answeredById))] } }, select: { id: true, name: true } });
  const events = await db.auditEvent.findMany({ where: { clientId, action: ANSWER_ACTIONS.accepted, entityType: 'PolicyQuestionAnswer', entityId: { in: rows.map((r) => r.id) } }, select: { entityId: true, after: true } });
  return rows.map((r) => ({
    id: r.id,
    ruleVersionId: r.ruleVersionId,
    question: r.question,
    answer: r.answer,
    answeredBy: users.find((u) => u.id === r.answeredById)?.name ?? 'Unknown',
    answeredAt: r.createdAt.toISOString(),
    aiStatus: r.aiStatus,
    aiMessage: r.aiMessage,
    changes: (Array.isArray(r.aiProposal) ? r.aiProposal : []) as unknown as ProposedChange[],
    costUsd: r.costUsd === null ? null : Number(r.costUsd),
    accepted: events.filter((e) => e.entityId === r.id).flatMap((e) => ((e.after as { fields?: string[] } | null)?.fields ?? [])),
  }));
}

const Params = z.object({ projectId: z.string().uuid(), ruleId: z.string().uuid() });
const AnswerBody = z.object({ expectedContentHash: z.string().min(1), question: z.string().trim().min(1).max(2000), answer: z.string().min(1).max(4000), fill: z.boolean().default(false) });
const AcceptBody = z.object({ expectedContentHash: z.string().min(1), fields: z.array(z.enum(ANSWER_FIELDS)).min(1) });

export const policyAnswerRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; storage: ObjectStorage; filler?: AnswerFiller }> = async (app, { db, config, storage, filler = defaultAnswerFiller(config) }) => {
  const loadText = (v: { textStorageKey: string }) => loadVersionText(storage, v);
  const label = (catalog: FactCatalog | null) => (c: unknown) => conditionLabel(c as never, catalog);

  app.post('/projects/:projectId/policy/rules/:ruleId/answers', { config: { access: POLICY_ACCESS, rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['policy'], params: Params, body: AnswerBody } }, async (req, reply) => {
    const actor = req.actor!;
    const p = await policyProject(db, actor, req.params.projectId);
    const latest = await db.policyRuleVersion.findFirst({ where: { ruleId: req.params.ruleId, clientId: actor.clientId, rule: { projectId: p.id } }, orderBy: { version: 'desc' }, include: { rule: { select: { ruleKey: true } } } });
    if (!latest) throw notFound('Rule not found');
    if (latest.contentHash !== req.body.expectedContentHash) throw conflict('This rule changed since you opened it. Reload, then answer again.');
    const body = PolicyRuleBody.parse(latest.body);
    let ai: { status: 'none' | 'proposed' | 'unmapped' | 'failed' | 'paused'; message: string | null; changes: ProposedChange[]; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; model: string | null } = { status: 'none', message: null, changes: [], inputTokens: null, outputTokens: null, costUsd: null, model: null };
    if (req.body.fill) {
      if (!config.AI_ANSWER_ENABLED) throw new AppError(409, 'AI_ANSWER_OFF', 'Fill from my answer is turned off. Save your answer and fill the fields by hand.');
      if ((await answerSpendToday(db, actor.clientId)) >= config.AI_ANSWER_DAILY_BUDGET_USD) ai = { ...ai, status: 'paused', message: PAUSED };
      else {
        const catalog = await conditionCatalog(db, p.id);
        const started = Date.now();
        try {
          const r = await filler.fill({ question: req.body.question, answer: req.body.answer, rule: { ruleKey: latest.rule.ruleKey, title: body.title, requirement: body.requirement, library: body.library ?? null, condition: body.condition ?? null, effectiveFrom: body.effective.from }, catalog });
          const cost = answerCostUsd(filler.model, r.inputTokens, r.outputTokens, config.POLICY_AI_PRICE_USD_PER_MTOK);
          const checked = checkedProposal(r.raw, body, catalog, label(catalog));
          ai = { status: checked.changes.length ? 'proposed' : 'unmapped', message: checked.message, changes: checked.changes, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: cost, model: filler.model };
          // Logged like the Support Bot's answers: model, time and tokens (and here the cost).
          req.log.info({ answerFill: { model: filler.model, ms: Date.now() - started, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: cost, changes: checked.changes.length } }, 'policy answer fill');
        } catch (err) {
          req.log.warn({ answerFill: { model: filler.model, ms: Date.now() - started, error: aiErrorForLog(err) } }, 'policy answer fill failed');
          ai = { ...ai, status: 'failed', model: filler.model, message: aiUnavailableMessage(err, 'Fill from my answer', 'Your answer is saved; fill the fields by hand.', 'The AI could not read your answer this time. Your answer is saved; try again or fill the fields by hand.') };
        }
      }
    }
    await runCommand(db, req, reply, async ({ tx, audit }) => {
      const row = await tx.policyQuestionAnswer.create({
        data: {
          clientId: actor.clientId,
          projectId: p.id,
          ruleId: req.params.ruleId,
          ruleVersionId: latest.id,
          contentHash: latest.contentHash,
          question: req.body.question,
          answer: req.body.answer,
          answeredById: actor.userId,
          aiStatus: ai.status,
          aiModel: ai.model,
          aiPromptVersion: req.body.fill ? ANSWER_PROMPT_VERSION : null,
          aiProposal: ai.changes.length ? (ai.changes as never) : undefined,
          aiMessage: ai.message,
          inputTokens: ai.inputTokens,
          outputTokens: ai.outputTokens,
          costUsd: ai.costUsd,
        },
      });
      await audit({ entityType: 'PolicyQuestionAnswer', entityId: row.id, action: ANSWER_ACTIONS.answered, after: { ruleId: req.params.ruleId, ruleVersionId: latest.id, aiStatus: ai.status, changes: ai.changes.map((c) => c.field), costUsd: ai.costUsd } });
      return { status: 201, body: (await answersFor(tx, actor.clientId, req.params.ruleId)).find((a) => a.id === row.id)! };
    });
    return reply;
  });

  app.post('/projects/:projectId/policy/answers/:answerId/accept', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: z.object({ projectId: z.string().uuid(), answerId: z.string().uuid() }), body: AcceptBody } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const a = await tx.policyQuestionAnswer.findFirst({ where: { id: req.params.answerId, clientId: actor.clientId, projectId: p.id } });
      if (!a) throw notFound('Answer not found');
      const proposed = (Array.isArray(a.aiProposal) ? a.aiProposal : []) as unknown as ProposedChange[];
      const chosen = proposed.filter((c) => req.body.fields.includes(c.field));
      if (chosen.length !== req.body.fields.length) throw new AppError(422, 'NOT_PROPOSED', 'Only changes the AI proposed for this answer can be accepted.');
      const latest = await tx.policyRuleVersion.findFirst({ where: { ruleId: a.ruleId, clientId: actor.clientId }, orderBy: { version: 'desc' } });
      if (!latest) throw notFound('Rule not found');
      // Accepting is an ordinary rule edit: a new draft, the quotes untouched, every check unchanged.
      const next = applyChanges(PolicyRuleBody.parse(latest.body), chosen);
      if (!PolicyRuleBody.safeParse(next).success) throw new AppError(422, 'CHANGES_INCOMPLETE', 'These changes can’t be saved on their own: customer types, product lines and channels need the Process too. Accept the Process change as well, or set the Process in Library details first.');
      const v = await editRule(tx, { loadText }, { clientId: actor.clientId, projectId: p.id, ruleId: a.ruleId, actorId: actor.userId, expectedContentHash: req.body.expectedContentHash, body: next }, audit);
      await audit({ entityType: 'PolicyQuestionAnswer', entityId: a.id, action: ANSWER_ACTIONS.accepted, after: { fields: chosen.map((c) => c.field), ruleVersionId: v.id } });
      return { status: 200, body: { versionId: v.id, version: v.version, state: v.state, contentHash: v.contentHash } };
    });
    return reply;
  });
};
