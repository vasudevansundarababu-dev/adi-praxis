import { AUTHORSHIP_VERSION, authoredChangeProblems, facilitatorQuestion } from './authorship';
import type { Prisma, TaskInstance } from '@prisma/client';
import { applyConversationChanges, ConversationProposal, type KycTask } from '@praxis/shared';
import type { Db, Tx } from '../../db';
import { AppError } from '../../lib/errors';
import { sha256, stableStringify } from '../../lib/crypto';
import { effectivePolicy } from '../../policy/task-policy';
import type { ConversationAssistant } from './assistant';
import { proposalProblems } from './guards';

export const CONVERSATION_VERSION = 'authoring-facilitator/2';
export const editable = (t: TaskInstance & {project?:{status:string}}) => {
  if(t.project?.status==='PAUSED')throw new AppError(409,'PROJECT_PAUSED','This project is paused.');
  if (t.taskType !== 'AUTHORING' || !['ASSIGNED', 'IN_PROGRESS', 'REWORK'].includes(t.status) || t.quarantinedAt) throw new AppError(409, 'READ_ONLY', 'Only an editable authoring task can use this conversation.');
};
export interface ChatState {
  humanOnly?: boolean;
  consent?: { version: string; at: string; smeUserId: string };
  declaration?: { revision: number; at: string; smeUserId: string };
  pending?: { runId: string; revision: number; policyDigest: string; proposal: ConversationProposal; problems: string[] };
  unresolved?: string[];
  policyLinks?: ConversationProposal['ruleLinks'];
  needsReview?: boolean;
  policyDigest?: string;
  reviewedRevision?: number;
}
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const chatOf = (t: Pick<TaskInstance, 'drafting'>) => ((t.drafting as { conversation?: ChatState } | null)?.conversation ?? {});
export const draftingWith = (t: Pick<TaskInstance, 'drafting'>, chat: ChatState) => ({ ...((t.drafting ?? {}) as object), sections: (t.drafting as { sections?: unknown } | null)?.sections ?? {}, conversation: chat });
export async function appendTurn(tx: Tx, t: TaskInstance, speaker: string, content: string, clientMessageId?: string) {
  const last = await tx.taskInterviewTurn.findFirst({ where: { taskInstanceId: t.id }, orderBy: { seq: 'desc' }, select: { seq: true } });
  return tx.taskInterviewTurn.create({ data: { clientId: t.clientId, taskInstanceId: t.id, seq: (last?.seq ?? 0) + 1, speaker, questionId: 'conversation', content, clientMessageId } });
}
export async function conversationView(db: Db | Tx, t: TaskInstance) {
  const [turns, runs, policy] = await Promise.all([
    db.taskInterviewTurn.findMany({ where: { taskInstanceId: t.id, questionId: 'conversation' }, orderBy: { seq: 'asc' }, take: 300 }),
    db.taskDraftRun.findMany({ where: { taskInstanceId: t.id, section: 'CHAT' }, orderBy: { createdAt: 'desc' }, take: 1 }),
    effectivePolicy(db, t.clientId, t),
  ]);
  return { revision: t.revision, output: t.output ?? {}, state: chatOf(t), messages: turns.map(x => ({ id: x.id, speaker: x.speaker, content: x.content })), run: runs[0] ? { id: runs[0].id, status: runs[0].status, error: runs[0].error, model: runs[0].model } : null, policy: policy?.body ?? null };
}
/** Model call outside transactions. Claim only QUEUED: uncertain RUNNING calls are never paid-retried automatically. */
export async function executeConversation(db: Db, assistant: ConversationAssistant, runId: string) {
  const run = await db.taskDraftRun.findUnique({ where: { id: runId } });
  if (!run || run.section !== 'CHAT' || run.status !== 'QUEUED') return;
  if (!(await db.taskDraftRun.updateMany({ where: { id: run.id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } })).count) return;
  try {
    const task = await db.taskInstance.findUniqueOrThrow({ where: { id: run.taskInstanceId }, include: { project: { include: { template: true } } } });
    editable(task);
    const start = JSON.parse(run.instruction!) as { revision: number; policyDigest: string };
    if (task.revision !== start.revision) throw new Error('Task changed before generation; send a fresh message.');
    const policy = await effectivePolicy(db, task.clientId, task);
    if ((policy?.digest ?? 'none') !== start.policyDigest) throw new Error('Project policy changed before generation.');
    const turns = await db.taskInterviewTurn.findMany({ where: { taskInstanceId: task.id }, orderBy: { seq: 'asc' }, take: 301 });
    if (turns.length > 300) throw new Error('Conversation limit reached. No prior messages were silently discarded.');
    const reviewFeedback = await db.taskReview.findMany({ where: { taskInstanceId: task.id, OR: [{ decision: { in: ['ACCEPT', 'REWORK', 'REJECT'] } }, { decision: 'EDIT', material: true }] }, orderBy: { createdAt: 'asc' }, select: { decision: true, comments: true, notes: true, submissionVersion: true } });
    let proposal = ConversationProposal.parse(await assistant.propose({ workflow: task.project.template.workflowName, reviewFeedback, template: { primaryWork: task.project.template.primaryWork, verificationCriteria: task.project.template.verificationCriteria, humanGate: task.project.template.humanGate, taskDefinitionSchema: task.project.template.taskDefinitionSchema, collectionSchema: task.project.template.collectionSchema }, current: (task.output ?? {}) as Record<string, unknown>, slot: task.input, history: turns.map(x => ({ speaker: x.speaker, content: x.content })), policy: policy?.body ?? null, previousUnresolved: chatOf(task).unresolved ?? [] }));
    const authors = turns.filter(t=>t.speaker==='AUTHOR' && t.questionId==='conversation' && t.clientMessageId?.startsWith('answer:')).map(t=>t.content);
    const unsupported = authoredChangeProblems((task.output ?? {}) as Record<string, unknown>, proposal, authors);
    const latestAnswer = authors.at(-1) ?? '';
    const safeQuestion = facilitatorQuestion(latestAnswer, (task.output ?? {}) as Record<string, unknown>, task.project.template.workflowName);
    proposal = { ...proposal, reply: unsupported.length ? 'I cannot generate task answers. Type the assessment yourself; I can help organise your words.' : 'I can organise your typed answer. Review its placement before confirming.', question: safeQuestion, changes: unsupported.length ? [] : proposal.changes.map(c=>({...c,reason:'Extracted from SME-authored content; confirm the placement.'})), ruleLinks: proposal.ruleLinks.map(l=>({...l,reason:'Suggested project-rule link; SME applicability confirmation required.'})), unresolved: unsupported.length ? ['SME must type the missing substantive content.'] : proposal.unresolved.map(()=> 'Confirm the outstanding evidence or policy applicability in your own words.') };
    const problems = [...unsupported, ...proposalProblems((task.output ?? {}) as Record<string, unknown>, proposal, policy?.body.rules ?? [], task.project.template.workflowName.toLowerCase() === 'kyc onboarding and refresh')];
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${task.id}::uuid FOR UPDATE`;
      const fresh = await tx.taskInstance.findUniqueOrThrow({ where: { id: task.id } });
      editable(fresh);
      const latestPolicy = await effectivePolicy(tx, task.clientId, task);
      if (fresh.revision !== start.revision || (latestPolicy?.digest ?? 'none') !== start.policyDigest) throw new Error('Task or policy changed while the model was working; proposal discarded.');
      const chat = chatOf(fresh);
      // Persist only redacted-safe assistant output: rejected output is not retained as a pending proposal.
      const safe = !problems.some(x => x.includes('sensitive'));
      if (safe) chat.pending = { runId, revision: fresh.revision, policyDigest: start.policyDigest, proposal, problems };
      else delete chat.pending;
      await tx.taskInstance.update({ where: { id: fresh.id }, data: { drafting: json(draftingWith(fresh, chat)) } });
      await appendTurn(tx, fresh, 'ASSISTANT', safe ? proposal.reply + '\n\n' + proposal.question : 'The generated proposal contained potentially sensitive data and was discarded. Please use synthetic placeholders.');
      await tx.taskDraftRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', model: assistant.model, problems: json(problems), finishedAt: new Date() } });
      await tx.auditEvent.create({ data: { clientId: fresh.clientId, actorType: 'SYSTEM', actorId: 'conversation-assistant', entityType: 'TaskInstance', entityId: fresh.id, action: 'task.conversation.proposed', after: { runId, model: assistant.model, problemCount: problems.length } } });
    });
  } catch {
    await db.$transaction(async tx => {
      await tx.taskDraftRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: 'Conversation generation unavailable or stale. Existing task unchanged. Start a fresh request; no automatic model retry.', finishedAt: new Date() } });
      await tx.auditEvent.create({ data: { clientId: run.clientId, actorType: 'SYSTEM', actorId: 'conversation-assistant', entityType: 'TaskInstance', entityId: run.taskInstanceId, action: 'task.conversation.failed', after: { runId } } });
    });
  }
}
export async function decideProposal(tx: Tx, task: TaskInstance, runId: string, accept: boolean) {
  const chat = chatOf(task), pending = chat.pending;
  if (!pending || pending.runId !== runId) throw new AppError(409, 'NO_PROPOSAL', 'That proposal is no longer pending.');
  if (accept) {
    const policy = await effectivePolicy(tx, task.clientId, task);
    if (task.revision !== pending.revision || (policy?.digest ?? 'none') !== pending.policyDigest) throw new AppError(409, 'STALE_REVISION', 'Task or project policy changed. Request a fresh proposal.');
    if (pending.problems.length) throw new AppError(422, 'PROPOSAL_BLOCKED', 'Resolve the proposal checks before applying changes.', { problems: pending.problems });
    let output: Record<string, unknown>;
    try {
      output = applyConversationChanges((task.output ?? {}) as Record<string, unknown>, pending.proposal);
    } catch (e) {
      throw new AppError(422, 'PROPOSAL_BLOCKED', 'This proposal no longer applies to the task. Request a fresh one.', { problems: [e instanceof Error ? e.message : 'invalid change'] });
    }
    chat.unresolved = pending.proposal.unresolved; chat.policyLinks = pending.proposal.ruleLinks; chat.needsReview = true; delete chat.declaration; delete chat.reviewedRevision; chat.policyDigest = pending.policyDigest;
    delete chat.pending;
    const drafting = draftingWith(task, chat) as { sections: Record<string, { confirmedAt: string | null }>; conversation: ChatState };
    // Any coordinated edit invalidates section confirmations; never claim regenerated output was human-reviewed.
    for (const section of Object.values(drafting.sections)) section.confirmedAt = null;
    await tx.taskInstance.update({ where: { id: task.id }, data: { output: json(output), drafting: json(drafting), revision: { increment: 1 }, lastSavedAt: new Date(), status: task.status === 'ASSIGNED' ? 'IN_PROGRESS' : task.status } });
  } else {
    delete chat.pending;
    await tx.taskInstance.update({ where: { id: task.id }, data: { drafting: json(draftingWith(task, chat)) } });
  }
  await appendTurn(tx, task, 'AUTHOR', accept ? 'Confirmed the coordinated proposal; dependent content needs review.' : 'Discarded the proposed changes.');
}
