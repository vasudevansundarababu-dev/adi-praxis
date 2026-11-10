import type { Prisma, TaskDraftRun, TaskInstance } from '@prisma/client';
import { KYC_MCP_CATALOG_VERSION, type KycTask, type TaskCheck } from '@praxis/shared';
import { createHash, randomUUID } from 'node:crypto';
import { detectSensitive } from '../../candidate/sensitive';
import type { MalwareScanner, ObjectStorage } from '../../candidate/storage';
import type { Db, Tx } from '../../db';
import { AppError } from '../../lib/errors';
import { sha256, stableStringify } from '../../lib/crypto';
import type { EventHandler } from '../../outbox/handlers';
import type { OutboxInput } from '../../outbox/outbox';
import type { writeAudit } from '../../platform/audit';
import { templateRef } from '../task-service';
import { DRAFT_SECTIONS, DrafterUnavailableError, emptySections, PROMPT_VERSION, sanitizeDraft, SECTION_KEYS, type DraftSection, type TaskDrafter } from './drafter';
import { interviewQuestions, nextQuestion, type InterviewAnswer, type SlotBrief } from './interview';
import { extractSourceText, scanSource, SOURCE_CONTENT_TYPES, type SourceFlag } from './source-text';

type Audit = (i: Parameters<typeof writeAudit>[2]) => Promise<void>;
type Emit = (e: OutboxInput) => Promise<void>;

/** Server-side drafting state on TaskInstance.drafting; autosave never changes it. */
export interface SectionState {
  runId: string;
  draftedAt: string;
  draftHash: string;
  confirmedAt: string | null;
}
export interface DraftingState {
  sections: Partial<Record<DraftSection, SectionState>>;
}

export const EDITABLE = ['ASSIGNED', 'IN_PROGRESS', 'REWORK'];
const KYC_WORKFLOW = 'kyc onboarding and refresh';

export const draftingOf = (t: Pick<TaskInstance, 'drafting'>): DraftingState => ((t.drafting as DraftingState | null) ?? { sections: {} });
export const sectionHash = (t: KycTask, s: DraftSection) => sha256(stableStringify(SECTION_KEYS[s].map((k) => t[k] ?? null)));
const slotOf = (t: Pick<TaskInstance, 'input'>): SlotBrief | null => ((t.input as { slot?: SlotBrief }).slot ?? null);

function assertEditable(t: Pick<TaskInstance, 'status'>) {
  if (!EDITABLE.includes(t.status)) throw new AppError(409, 'READ_ONLY', 'This task is read-only now.');
}

/** Drafting is offered for authored KYC tasks (the KYC task definition); other workflows have their own specs. */
export async function assertDraftable(tx: Db | Tx, t: Pick<TaskInstance, 'taskType' | 'projectId'>) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: t.projectId }, include: { template: true } });
  if (t.taskType !== 'AUTHORING' || p.template.workflowName.toLowerCase() !== KYC_WORKFLOW) throw new AppError(409, 'NOT_DRAFTABLE', 'Drafting from documents or an interview is available for KYC authoring tasks.');
}

/** W06: every drafted section must be confirmed by the author before submit (TASK-DRAFTING section 4). */
export function draftingChecks(t: Pick<TaskInstance, 'drafting'>): TaskCheck[] {
  const sections = Object.entries(draftingOf(t).sections) as [DraftSection, SectionState][];
  const chat = (t.drafting as { conversation?: { pending?: unknown; needsReview?: boolean; unresolved?: string[]; humanOnly?: boolean; consent?: {version:string}; declaration?: {revision:number} } } | null)?.conversation;
  const chatChecks: TaskCheck[] = chat ? [{ id: 'conversation.review', section: 'W06', ok: !chat.pending && !chat.needsReview && !(chat.unresolved?.length) && (!chat.humanOnly || (!!chat.consent && !!chat.declaration)), message: 'Resolve conversation questions and review coordinated edits before submission' }] : [];
  if (!sections.length) return chatChecks;
  const open = sections.filter(([, s]) => !s.confirmedAt).map(([k]) => k).sort();
  return [...chatChecks, { id: 'drafting.confirmed', section: 'W06', ok: open.length === 0, message: open.length ? `Check and confirm the AI-drafted section(s): ${open.join(', ')}` : 'Every AI-drafted section was checked and confirmed by you' }];
}

// ───────────────────────── Sources ─────────────────────────

export async function uploadSource(
  tx: Tx,
  deps: { storage: ObjectStorage; scanner: MalwareScanner },
  args: { task: TaskInstance; smeUserId: string; kind: 'DOCUMENT' | 'TRANSCRIPT'; fileName: string; buf: Buffer; declaration: boolean },
  audit: Audit,
) {
  assertEditable(args.task);
  await assertDraftable(tx, args.task);
  if (!args.declaration) throw new AppError(400, 'DECLARATION_REQUIRED', 'Confirm the file contains no customer data and that you may share it.');
  if ((await tx.taskSource.count({ where: { taskInstanceId: args.task.id, deletedAt: null } })) >= 5) throw new AppError(409, 'TOO_MANY_SOURCES', 'A task can have up to 5 sources. Remove one first.');
  const { format, text } = await extractSourceText(args.buf);
  const scan = await deps.scanner.scan(args.buf);
  if (scan === 'INFECTED') throw new AppError(422, 'FILE_REJECTED', 'This file could not be accepted.');
  const { flags } = scanSource(text);
  const storageKey = `task-sources/${args.task.id}/${randomUUID()}.${format}`;
  await deps.storage.put(storageKey, args.buf, SOURCE_CONTENT_TYPES[format]);
  const s = await tx.taskSource.create({
    data: {
      clientId: args.task.clientId,
      taskInstanceId: args.task.id,
      kind: args.kind,
      fileName: args.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || `source.${format}`,
      contentType: SOURCE_CONTENT_TYPES[format],
      sizeBytes: args.buf.length,
      sha256: createHash('sha256').update(args.buf).digest('hex'),
      storageKey,
      textChars: text.length,
      scanFlags: flags as unknown as Prisma.InputJsonValue,
      scanStatus: scan,
      uploadedById: args.smeUserId,
    },
  });
  await audit({ entityType: 'TaskInstance', entityId: args.task.id, action: 'task.source.uploaded', after: { sourceId: s.id, kind: s.kind, format, sizeBytes: s.sizeBytes, sha256: s.sha256, textChars: s.textChars } });
  if (flags.length) await audit({ entityType: 'TaskInstance', entityId: args.task.id, action: 'task.source.flagged', after: { sourceId: s.id, kinds: [...new Set(flags.map((f) => f.kind))], count: flags.length } });
  return s;
}

export async function removeSource(tx: Tx, storage: ObjectStorage, args: { task: TaskInstance; sourceId: string }, audit: Audit) {
  assertEditable(args.task);
  const s = await tx.taskSource.findFirst({ where: { id: args.sourceId, taskInstanceId: args.task.id, deletedAt: null } });
  if (!s) throw new AppError(404, 'NOT_FOUND', 'Source not found');
  await tx.taskSource.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
  await storage.delete(s.storageKey);
  await audit({ entityType: 'TaskInstance', entityId: args.task.id, action: 'task.source.removed', after: { sourceId: s.id, sha256: s.sha256 } });
}

// ───────────────────────── Interview ─────────────────────────

export async function interviewState(tx: Db | Tx, t: Pick<TaskInstance, 'id' | 'input'>) {
  const questions = interviewQuestions(slotOf(t));
  const turns = await tx.taskInterviewTurn.findMany({ where: { taskInstanceId: t.id }, orderBy: { seq: 'asc' } });
  const answered = new Set(turns.filter((x) => x.speaker === 'AUTHOR').map((x) => x.questionId));
  const next = nextQuestion(questions, answered);
  return {
    turns: turns.map((x) => ({ id: x.id, speaker: x.speaker, questionId: x.questionId, content: x.content, redacted: x.redacted, at: x.createdAt.toISOString() })),
    next: next ? { ...next, number: questions.indexOf(next) + 1, total: questions.length } : null,
    answered: answered.size,
    total: questions.length,
    complete: !next,
  };
}

export async function answerInterview(tx: Tx, args: { task: TaskInstance; clientMessageId: string; questionId: string; content: string; skip: boolean }, audit: Audit) {
  assertEditable(args.task);
  await assertDraftable(tx, args.task);
  const dup = await tx.taskInterviewTurn.findUnique({ where: { taskInstanceId_clientMessageId: { taskInstanceId: args.task.id, clientMessageId: args.clientMessageId } } });
  if (dup) {
    // A retried message (same client id): nothing changes, but the attempt is on record.
    await audit({ entityType: 'TaskInstance', entityId: args.task.id, action: 'task.interview.retry_ignored', after: { questionId: dup.questionId } });
    return interviewState(tx, args.task);
  }
  await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${args.task.id}::uuid FOR UPDATE`;
  const state = await interviewState(tx, args.task);
  if (!state.next) throw new AppError(409, 'INTERVIEW_COMPLETE', 'The interview is complete. Draft your task, or redraft a section with an instruction.');
  if (state.next.id !== args.questionId) throw new AppError(409, 'STALE_QUESTION', 'This question was already answered in another window. Reload to continue.');
  if (args.skip && state.next.required) throw new AppError(422, 'ANSWER_REQUIRED', 'This question needs an answer.');
  const content = args.skip ? '(skipped)' : args.content.trim();
  if (!content) throw new AppError(422, 'ANSWER_REQUIRED', 'Type an answer or tap an option.');
  // Sensitive content is never stored; only the redacted copy is kept (as in the profile chat).
  const s = detectSensitive(content);
  const seq = state.turns.length;
  await tx.taskInterviewTurn.create({ data: { clientId: args.task.clientId, taskInstanceId: args.task.id, seq, speaker: 'ASSISTANT', questionId: state.next.id, content: state.next.text } });
  await tx.taskInterviewTurn.create({ data: { clientId: args.task.clientId, taskInstanceId: args.task.id, seq: seq + 1, speaker: 'AUTHOR', questionId: state.next.id, content: s.redacted.slice(0, 4000), redacted: s.flagged, clientMessageId: args.clientMessageId } });
  await audit({ entityType: 'TaskInstance', entityId: args.task.id, action: 'task.interview.answered', after: { questionId: state.next.id, redacted: s.flagged, skipped: args.skip } });
  return interviewState(tx, args.task);
}

// ───────────────────────── Drafts ─────────────────────────

export async function requestDraft(tx: Tx, args: { task: TaskInstance; smeUserId: string; section: DraftSection | null; instruction: string | null }, audit: Audit, emit: Emit) {
  assertEditable(args.task);
  await assertDraftable(tx, args.task);
  if ((await tx.project.findUniqueOrThrow({where:{id:args.task.projectId}})).authoringExperience) throw new AppError(409,'HUMAN_AUTHORING_ONLY','Model-generated answers are disabled for this project.');
  await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${args.task.id}::uuid FOR UPDATE`;
  if ((args.task.drafting as {conversation?: {humanOnly?: boolean}} | null)?.conversation?.humanOnly) throw new AppError(409,'HUMAN_AUTHORING_ONLY','AI drafting is disabled for human-authored conversational tasks. Write the answer yourself.');
  const running = await tx.taskDraftRun.findFirst({ where: { taskInstanceId: args.task.id, status: { in: ['QUEUED', 'RUNNING'] } } });
  if (running) throw new AppError(409, 'DRAFT_IN_PROGRESS', 'A draft is already being written for this task. Wait for it to finish.', { runId: running.id });
  const sources = await tx.taskSource.findMany({ where: { taskInstanceId: args.task.id, deletedAt: null }, select: { id: true } });
  const answers = await tx.taskInterviewTurn.count({ where: { taskInstanceId: args.task.id, speaker: 'AUTHOR' } });
  if (!sources.length && answers < 3) throw new AppError(422, 'NOTHING_TO_DRAFT_FROM', 'Upload a document or transcript, or answer at least three interview questions, before drafting.');
  const run = await tx.taskDraftRun.create({
    data: { clientId: args.task.clientId, taskInstanceId: args.task.id, section: args.section, instruction: args.instruction, sourceIds: sources.map((s) => s.id), interviewTurns: answers, promptVersion: PROMPT_VERSION, requestedById: args.smeUserId },
  });
  await audit({ entityType: 'TaskInstance', entityId: args.task.id, action: 'task.draft.requested', after: { runId: run.id, section: args.section ?? 'ALL', instruction: !!args.instruction, sources: sources.length, interviewAnswers: answers } });
  await emit({ name: 'task.draft.requested', aggregateType: 'TaskInstance', aggregateId: args.task.id, payload: { taskId: args.task.id, runId: run.id } });
  return run;
}

export const runView = (r: TaskDraftRun) => ({
  id: r.id,
  section: r.section,
  status: r.status,
  sections: r.sections,
  model: r.model,
  problems: r.problems,
  error: r.error,
  notes: r.notes,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

async function fail(db: Db, run: TaskDraftRun, error: string, problems: string[] = []) {
  await db.taskDraftRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: error.slice(0, 1000), problems: problems as unknown as Prisma.InputJsonValue, finishedAt: new Date() } });
  await db.auditEvent.create({ data: { clientId: run.clientId, actorType: 'SYSTEM', actorId: 'drafter', entityType: 'TaskInstance', entityId: run.taskInstanceId, action: 'task.draft.failed', after: { runId: run.id, error: error.slice(0, 300) } } });
}

/**
 * The worker's side (a `run` handler: the model call must not hold a transaction). Writes the requested sections
 * into the task, marks them drafted and unconfirmed, and never touches confirmed sections on "draft all". One retry
 * when the output is unusable; nothing half-valid is saved.
 */
export async function executeDraft(db: Db, deps: { drafter: TaskDrafter; storage: ObjectStorage }, runId: string) {
  const run = await db.taskDraftRun.findUnique({ where: { id: runId } });
  if (!run || run.section === 'CHAT' || run.status === 'SUCCEEDED' || run.status === 'FAILED') return;
  const claimed = await db.taskDraftRun.updateMany({ where: { id: run.id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'RUNNING', startedAt: new Date() } });
  if (!claimed.count) return;
  const task = await db.taskInstance.findUniqueOrThrow({ where: { id: run.taskInstanceId }, include: { project: true } });
  if ((await db.project.findUniqueOrThrow({where:{id:task.projectId}})).authoringExperience) return fail(db,run,'Project requires human authorship.');
  if ((task.drafting as {conversation?:{humanOnly?:boolean}}|null)?.conversation?.humanOnly) return fail(db,run,'Human-authorship controls prohibit AI drafting.');
  if (!EDITABLE.includes(task.status)) return fail(db, run, 'The task was submitted or closed before the draft finished.');

  const state = draftingOf(task);
  const sections: DraftSection[] = run.section ? [run.section as DraftSection] : DRAFT_SECTIONS.filter((s) => !state.sections[s]?.confirmedAt);
  if (!sections.length) return fail(db, run, 'Every section is already confirmed. Redraft one section to replace it.');

  const template = await templateRef(db, task.project.templateId);
  const tpl = await db.template.findUniqueOrThrow({ where: { id: task.project.templateId } });
  const sources = await db.taskSource.findMany({ where: { id: { in: run.sourceIds }, deletedAt: null } });
  const texts: { kind: 'DOCUMENT' | 'TRANSCRIPT'; name: string; text: string }[] = [];
  const forbidden = new Set<string>();
  for (const s of sources) {
    const { text } = await extractSourceText(await deps.storage.get(s.storageKey));
    scanSource(text).forbidden.forEach((f) => forbidden.add(f));
    texts.push({ kind: s.kind, name: s.fileName, text });
  }
  const turns = await db.taskInterviewTurn.findMany({ where: { taskInstanceId: task.id }, orderBy: { seq: 'asc' } });
  const interview: InterviewAnswer[] = turns.filter((x) => x.speaker === 'AUTHOR' && x.content !== '(skipped)').map((a) => ({ questionId: a.questionId, question: turns.find((q) => q.speaker === 'ASSISTANT' && q.questionId === a.questionId)?.content ?? a.questionId, answer: a.content }));
  const current = (task.output ?? {}) as KycTask;
  const input = {
    slot: slotOf(task),
    template: { workflow: template.workflowName, primaryWork: tpl.primaryWork, verificationCriteria: tpl.verificationCriteria, humanGate: tpl.humanGate, coverageDimensions: template.coverageDimensions },
    sources: texts,
    interview,
    current,
    sections,
    instruction: run.instruction,
    forbidden: [...forbidden],
  };

  let attempt = 0;
  let result: { task: KycTask; problems: string[]; notes: string; model: string } | null = null;
  let lastProblem = '';
  while (attempt < 2 && !result) {
    attempt++;
    try {
      const d = await deps.drafter.draft(input);
      const s = sanitizeDraft(d.task, input);
      const empty = emptySections(s.task, sections);
      if (empty.length) lastProblem = `The draft left section(s) ${empty.join(', ')} empty`;
      else result = { task: s.task, problems: s.problems, notes: d.notes, model: d.model };
    } catch (err) {
      lastProblem = err instanceof DrafterUnavailableError ? `The drafting assistant is unavailable: ${err.message}` : `Drafting failed: ${String(err)}`;
      if (!(err instanceof DrafterUnavailableError)) break;
    }
  }
  if (!result) return fail(db, run, `${lastProblem}. Your work is unchanged; you can write the section(s) yourself or try again.`);

  const now = new Date().toISOString();
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "TaskInstance" WHERE id = ${task.id}::uuid FOR UPDATE`;
    const fresh = await tx.taskInstance.findUniqueOrThrow({ where: { id: task.id } });
    if ((fresh.drafting as {conversation?:{humanOnly?:boolean}}|null)?.conversation?.humanOnly) throw new AppError(409,'HUMAN_AUTHORING_ONLY','Task now requires human authorship.');
    if (!EDITABLE.includes(fresh.status)) throw new AppError(409, 'READ_ONLY', 'The task was submitted before the draft finished.');
    const merged: KycTask = { ...((fresh.output ?? {}) as KycTask) };
    const st = draftingOf(fresh);
    for (const s of sections) {
      for (const k of SECTION_KEYS[s]) (merged as Record<string, unknown>)[k] = result!.task[k];
      st.sections[s] = { runId: run.id, draftedAt: now, draftHash: sectionHash(merged, s), confirmedAt: null };
    }
    await tx.taskInstance.update({
      where: { id: task.id },
      data: { output: merged as unknown as Prisma.InputJsonValue, drafting: st as unknown as Prisma.InputJsonValue, status: fresh.status === 'ASSIGNED' ? 'IN_PROGRESS' : fresh.status, startedAt: fresh.startedAt ?? new Date(), revision: { increment: 1 } },
    });
    await tx.taskDraftRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', model: result!.model, sections, problems: result!.problems as unknown as Prisma.InputJsonValue, notes: result!.notes || null, finishedAt: new Date() } });
    await tx.auditEvent.create({ data: { clientId: run.clientId, actorType: 'SYSTEM', actorId: 'drafter', entityType: 'TaskInstance', entityId: task.id, action: 'task.draft.completed', after: { runId: run.id, sections, model: result!.model, promptVersion: PROMPT_VERSION, problems: result!.problems.length } } });
  }).catch(async (err) => {
    if (err instanceof AppError) return fail(db, run, err.message);
    throw err;
  });
}

export function draftOnRequest(deps: { drafter: TaskDrafter; storage: ObjectStorage }): EventHandler {
  return {
    name: 'm9.draft-task',
    event: 'task.draft.requested',
    async run(event, db) {
      const { runId } = event.payload as { runId: string };
      await executeDraft(db, deps, runId);
    },
  };
}

export async function confirmSection(tx: Tx, args: { task: TaskInstance; section: DraftSection }, audit: Audit) {
  assertEditable(args.task);
  const st = draftingOf(args.task);
  const s = st.sections[args.section];
  if (!s) throw new AppError(409, 'NOT_DRAFTED', 'Only AI-drafted sections need confirming.');
  const already = !!s.confirmedAt;
  if (!already) {
    s.confirmedAt = new Date().toISOString();
    await tx.taskInstance.update({ where: { id: args.task.id }, data: { drafting: st as unknown as Prisma.InputJsonValue } });
  }
  const edited = sectionHash((args.task.output ?? {}) as KycTask, args.section) !== s.draftHash;
  await audit({ entityType: 'TaskInstance', entityId: args.task.id, action: 'task.section.confirmed', after: { section: args.section, editedAfterDraft: edited, alreadyConfirmed: already } });
  return st;
}

// ───────────────────────── Views and provenance ─────────────────────────

const sourceView = (s: { id: string; kind: string; fileName: string; contentType: string; sizeBytes: number; sha256: string; textChars: number; scanFlags: unknown; createdAt: Date }) => ({
  id: s.id,
  kind: s.kind,
  fileName: s.fileName,
  contentType: s.contentType,
  sizeBytes: s.sizeBytes,
  sha256: s.sha256,
  textChars: s.textChars,
  flags: s.scanFlags as SourceFlag[],
  uploadedAt: s.createdAt.toISOString(),
});

/** What the author and the Reviewer see about how a task was made (TASK-DRAFTING section 6). */
export async function draftingView(tx: Db | Tx, t: TaskInstance) {
  const [sources, runs, interview] = await Promise.all([
    tx.taskSource.findMany({ where: { taskInstanceId: t.id, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    tx.taskDraftRun.findMany({ where: { taskInstanceId: t.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    interviewState(tx, t),
  ]);
  const st = draftingOf(t);
  const out = (t.output ?? {}) as KycTask;
  return {
    authorship: (t.drafting as {conversation?:{humanOnly?:boolean;consent?:unknown;declaration?:unknown}}|null)?.conversation?.humanOnly ? {mode:"HUMAN_ONLY",consent:(t.drafting as any).conversation.consent,declaration:(t.drafting as any).conversation.declaration,limitations:"Consent and similarity are review signals, not proof of external LLM use."} : null,
    humanOnly: !!(t.drafting as {conversation?:{humanOnly?:boolean}}|null)?.conversation?.humanOnly,
    sources: sources.map(sourceView),
    interview,
    runs: runs.map(runView),
    sections: Object.fromEntries((Object.entries(st.sections) as [DraftSection, SectionState][]).map(([k, s]) => [k, { draftedAt: s.draftedAt, confirmedAt: s.confirmedAt, editedAfterDraft: sectionHash(out, k) !== s.draftHash }])),
  };
}

/** Provenance written into the ApprovedTaskRecord: kinds, hashes, model and versions; never source content. */
export async function provenanceFor(tx: Db | Tx, t: TaskInstance, workflow: string) {
  if (t.taskType !== 'AUTHORING' || (workflow.toLowerCase() !== KYC_WORKFLOW && !(t.drafting as any)?.conversation?.humanOnly)) return null;
  const [sources, runs, answers] = await Promise.all([
    tx.taskSource.findMany({ where: { taskInstanceId: t.id }, orderBy: { createdAt: 'asc' } }),
    tx.taskDraftRun.findMany({ where: { taskInstanceId: t.id, status: 'SUCCEEDED' }, orderBy: { createdAt: 'asc' } }),
    tx.taskInterviewTurn.count({ where: { taskInstanceId: t.id, speaker: 'AUTHOR' } }),
  ]);
  const st = draftingOf(t);
  const out = (t.output ?? {}) as KycTask;
  return {
    mcpCatalogVersion: KYC_MCP_CATALOG_VERSION,
    drafted: runs.some(r=>r.section!=='CHAT'),
    ...((t.drafting as any)?.conversation?.humanOnly ? {authorship:{mode:"HUMAN_ONLY",consent:(t.drafting as any).conversation.consent,declaration:(t.drafting as any).conversation.declaration},facilitationRuns:runs.filter(r=>r.section==='CHAT').map(r=>({model:r.model,promptVersion:r.promptVersion}))} : {}),
    sources: sources.map((s) => ({ kind: s.kind, sha256: s.sha256, removed: !!s.deletedAt })),
    interviewAnswers: answers,
    draftRuns: runs.filter(r=>r.section!=='CHAT').map((r) => ({ model: r.model, promptVersion: r.promptVersion, sections: r.sections })),
    sections: Object.fromEntries((Object.entries(st.sections) as [DraftSection, SectionState][]).map(([k, s]) => [k, { drafted: true, confirmed: !!s.confirmedAt, editedAfterDraft: sectionHash(out, k) !== s.draftHash }])),
  };
}
