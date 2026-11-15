import { Prisma, type Template, type TemplateTutorialRun } from '@prisma/client';
import { OPEN_TUTORIAL_RUN_STATUSES, TutorialChapter, TutorialScript, type Tutorial, type TutorialRunDto } from '@praxis/shared';
import { z } from 'zod';
import type { SignedUrlStorage } from '../../candidate/storage';
import type { Config, TutorialConfig } from '../../config';
import type { Db, Tx } from '../../db';
import { AppError } from '../../lib/errors';
import { writeAudit, type AuditInput } from '../../platform/audit';
import type { OutboxInput } from '../../outbox/outbox';
import { capProblem, clipCost, estimateUsd, lockSpend, recordSpend, spentTodayUsd, textCost } from './cost';
import { chapterPlan, finalizeScript, profileOf, type ChapterPlan } from './plan';
import type { TutorialScriptDrafter } from './script';
import { CLIP_SECONDS, type ChapterMedia, type Stitcher } from './stitch';
import { ClipError, type ClipGenerator } from './veo';
import type { NarrationSynthesizer } from './tts';

/**
 * D2 (docs/plan/PLAN-D2-TUTORIAL-VIDEO.md): AI tutorial videos per template version. A run drafts the script, makes the
 * clips and narration, stitches them and stores the video for an Admin to preview. Only an Admin's approval puts it on
 * the template, and so in front of SMEs and Reviewers; AI never decides. A missing or failed video never blocks publish.
 */

export interface TutorialSettings {
  tutorial: TutorialConfig;
  appEnv: Config['appEnv'];
}

export interface TutorialPipeline {
  script: TutorialScriptDrafter;
  clips: ClipGenerator;
  narration: NarrationSynthesizer;
  stitcher: Stitcher;
  storage: SignedUrlStorage;
  settings: TutorialSettings;
  /** Clips made at the same time. */
  concurrency?: number;
}

const SYSTEM_ACTOR = { actorType: 'SYSTEM', actorId: 'tutorial-video' } as const;
/** A run still "working" after this long has stopped (worker restart); a new request closes it. */
const STALE_RUN_MS = 2 * 3600_000;
const SIGNED_URL_SECONDS = 12 * 3600;
const WORKING = ['QUEUED', 'SCRIPTING', 'CLIPS', 'NARRATION', 'STITCHING'] as const;
/** Used for a retry when the video model's safety filter refused a scene. */
const FALLBACK_SCENE = 'Calm abstract office background with soft daylight and a slow camera move. No text, no screens, no people.';

export const STORAGE_PREFIX = 'storage:';
const videoKey = (lineageId: string, runId: string) => `tutorials/${lineageId}/${runId}/tutorial.mp4`;
const captionsKeyFor = (video: string) => video.replace(/tutorial\.mp4$/, 'captions.vtt');

const num = (d: Prisma.Decimal | number) => Number(d);
const Chapters = z.array(TutorialChapter);

/** Whether the mock pipeline or live calls run here, and whether generation may start at all. */
function environmentProblem(s: TutorialSettings): string | null {
  if (s.tutorial.live) {
    if (s.tutorial.costCapUsd === null || s.tutorial.dailyCapUsd === null) return 'Tutorial generation needs both cost caps to be set.';
    return null;
  }
  // The mock pipeline makes placeholder files: never in a deployed environment.
  return s.appEnv === 'local' ? null : 'Tutorial video generation is switched off in this environment.';
}

export interface GenerationStatus {
  blockedReason: string | null;
  live: boolean;
  estimatedUsd: number;
  worstCaseUsd: number;
  spentTodayUsd: number;
  costCapUsd: number | null;
  dailyCapUsd: number | null;
  chapters: number;
  plan: ChapterPlan[];
}

/** What the Generate button needs to show first, and why it can't start (null when it can). */
export async function generationStatus(tx: Db | Tx, s: TutorialSettings, t: Template, openRun: TemplateTutorialRun | null): Promise<GenerationStatus> {
  const profile = profileOf(t);
  const plan = profile ? chapterPlan(t, profile) : [];
  const { expected, worstCase } = estimateUsd(s.tutorial, plan.length);
  const spent = await spentTodayUsd(tx);
  const blockedReason =
    (!profile ? 'This template has no sections form, so a tutorial cannot be made from it.' : null) ??
    (t.status !== 'PUBLISHED' ? 'Publish this version first: tutorials are made for published templates.' : null) ??
    environmentProblem(s) ??
    (openRun ? 'A tutorial for this workflow is already being made or waiting for approval.' : null) ??
    capProblem(s.tutorial, worstCase, spent);
  return { blockedReason, live: s.tutorial.live, estimatedUsd: expected, worstCaseUsd: worstCase, spentTodayUsd: spent, costCapUsd: s.tutorial.costCapUsd, dailyCapUsd: s.tutorial.dailyCapUsd, chapters: plan.length, plan };
}

/** The open run of a workflow, closing one that stopped responding (its reservation is released). */
export async function openRunOf(tx: Tx, clientId: string, lineageId: string, audit: (i: AuditInput) => Promise<void>) {
  const open = await tx.templateTutorialRun.findFirst({ where: { clientId, lineageId, status: { in: [...OPEN_TUTORIAL_RUN_STATUSES] } } });
  if (open && (WORKING as readonly string[]).includes(open.status) && Date.now() - open.updatedAt.getTime() > STALE_RUN_MS) {
    await tx.templateTutorialRun.update({ where: { id: open.id }, data: { status: 'FAILED', error: 'The generation stopped responding.' } });
    await releaseReservation(tx, open);
    await audit({ entityType: 'TemplateTutorialRun', entityId: open.id, action: 'template.tutorial_failed', before: { status: open.status }, after: { status: 'FAILED', error: 'The generation stopped responding.' } });
    return null;
  }
  return open;
}

export type RequestOutcome = { kind: 'started' | 'existing'; run: TemplateTutorialRun } | { kind: 'refused'; reason: string };

/**
 * Starts a run for a published template version, inside the caller's transaction: reserves the worst-case cost under
 * the environment-wide lock and writes the outbox event. A refusal is audited and returned, never thrown, so a publish
 * that triggers it always succeeds.
 */
export async function requestTutorialRun(
  tx: Tx,
  ctx: { clientId: string; audit(i: AuditInput): Promise<void>; emit(e: OutboxInput): Promise<void> },
  s: TutorialSettings,
  input: { template: Template; trigger: 'PUBLISH' | 'ADMIN'; requestedBy: string | null },
): Promise<RequestOutcome> {
  const t = input.template;
  await lockSpend(tx);
  const open = await openRunOf(tx, ctx.clientId, t.lineageId, ctx.audit);
  if (open && open.templateId === t.id) return { kind: 'existing', run: open };
  const status = await generationStatus(tx, s, t, open);
  if (status.blockedReason) {
    await ctx.audit({ entityType: 'Template', entityId: t.id, action: 'template.tutorial_refused', after: { trigger: input.trigger, reason: status.blockedReason, worstCaseUsd: status.worstCaseUsd, spentTodayUsd: status.spentTodayUsd } });
    return { kind: 'refused', reason: status.blockedReason };
  }
  const run = await tx.templateTutorialRun.create({
    data: {
      clientId: ctx.clientId,
      templateId: t.id,
      lineageId: t.lineageId,
      trigger: input.trigger,
      scriptModel: s.tutorial.live ? s.tutorial.scriptModel : 'mock',
      videoModel: s.tutorial.live ? s.tutorial.veoModel : 'mock',
      estimatedUsd: new Prisma.Decimal(status.worstCaseUsd),
      requestedBy: input.requestedBy,
    },
  });
  await recordSpend(tx, run, 'reserve', 'reservation', status.worstCaseUsd);
  await ctx.emit({ name: 'template.tutorial_requested', aggregateType: 'TemplateTutorialRun', aggregateId: run.id, payload: { runId: run.id } });
  await ctx.audit({
    entityType: 'TemplateTutorialRun',
    entityId: run.id,
    action: 'template.tutorial_requested',
    after: { templateId: t.id, version: t.version, trigger: input.trigger, chapters: status.chapters, estimatedUsd: status.estimatedUsd, reservedUsd: status.worstCaseUsd, live: s.tutorial.live },
  });
  return { kind: 'started', run };
}

async function releaseReservation(tx: Db | Tx, run: { id: string; clientId: string }) {
  const rows = await tx.tutorialSpend.findMany({ where: { runId: run.id } });
  if (rows.some((r) => r.kind === 'release')) return;
  const reserved = rows.filter((r) => r.kind === 'reserve').reduce((n, r) => n + num(r.amountUsd), 0);
  await recordSpend(tx, run, 'release', 'reservation', reserved);
}

export class TutorialCapError extends Error {
  override name = 'TutorialCapError';
}

/** Records a billed call before it is made; refuses it when the run would go over its per-video cap. */
async function charge(db: Db, cfg: TutorialConfig, run: { id: string; clientId: string }, provider: string, amount: number) {
  const runId = run.id;
  await db.$transaction(async (tx) => {
    await lockSpend(tx);
    const spent = await tx.tutorialSpend.aggregate({ where: { runId, kind: 'actual' }, _sum: { amountUsd: true } });
    const total = num(spent._sum.amountUsd ?? 0) + amount;
    if (cfg.costCapUsd !== null && total > cfg.costCapUsd + 1e-9) throw new TutorialCapError(`Stopped: the per-video cost cap of $${cfg.costCapUsd.toFixed(2)} was reached.`);
    await recordSpend(tx, run, 'actual', provider, amount);
    await tx.templateTutorialRun.update({ where: { id: runId }, data: { actualUsd: new Prisma.Decimal(Math.round(total * 10_000) / 10_000) } });
  });
}

async function mapPool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

async function setStatus(db: Db, runId: string, status: TemplateTutorialRun['status'], data: Prisma.TemplateTutorialRunUpdateInput = {}) {
  await db.templateTutorialRun.update({ where: { id: runId }, data: { status, ...data } });
}

/**
 * Runs the pipeline for one queued run (the outbox handler). Claims the run first, so a redelivered event does nothing.
 * Any failure marks the run FAILED with a plain reason and releases the unused reservation; the template is untouched.
 */
export async function executeTutorialRun(db: Db, p: TutorialPipeline, runId: string): Promise<void> {
  const { count } = await db.templateTutorialRun.updateMany({ where: { id: runId, status: 'QUEUED' }, data: { status: 'SCRIPTING' } });
  if (count === 0) return;
  const run = (await db.templateTutorialRun.findUnique({ where: { id: runId }, include: { template: true } }))!;
  const cfg = p.settings.tutorial;
  try {
    const profile = profileOf(run.template);
    if (!profile) throw new Error('This template has no sections form.');
    const plan = chapterPlan(run.template, profile);

    await charge(db, cfg, run, `script:${p.script.model}`, textCost(cfg) * plan.length);
    const drafted = await p.script.draft({ workflowName: run.template.workflowName, chapters: plan });
    const final = finalizeScript(drafted.script, plan);
    if ('problem' in final) throw new Error(final.problem);
    const script = final.script;
    await setStatus(db, runId, 'CLIPS', { script: script as unknown as Prisma.InputJsonValue });

    const scenes = script.chapters.flatMap((c, i) => c.scenes.map((scene) => ({ chapter: i, scene })));
    const clips = await mapPool(scenes, p.concurrency ?? 3, async ({ scene }) => {
      for (let attempt = 1; ; attempt++) {
        await charge(db, cfg, run, `veo:${p.clips.model}`, clipCost(cfg));
        try {
          return await p.clips.generate(attempt === 1 ? scene : FALLBACK_SCENE, CLIP_SECONDS);
        } catch (e) {
          if (attempt >= 2) throw e instanceof ClipError ? new Error(`A video clip could not be made: ${e.message}.`) : e;
        }
      }
    });

    await setStatus(db, runId, 'NARRATION');
    const media: ChapterMedia[] = [];
    for (const [i, c] of script.chapters.entries()) {
      await charge(db, cfg, run, `tts:${p.narration.voice}`, textCost(cfg));
      const voice = await p.narration.synthesize(c.narration);
      media.push({ title: c.title, narration: c.narration, cards: c.cards, clips: clips.filter((_, j) => scenes[j]!.chapter === i), audio: voice.audio, audioSeconds: voice.seconds });
    }

    await setStatus(db, runId, 'STITCHING');
    const out = await p.stitcher.stitch(media);
    const key = videoKey(run.lineageId, runId);
    await p.storage.put(key, out.video, 'video/mp4');
    await p.storage.put(captionsKeyFor(key), Buffer.from(out.captions, 'utf8'), 'text/vtt');

    await db.$transaction(async (tx) => {
      const r = await tx.templateTutorialRun.update({
        where: { id: runId },
        data: { status: 'READY_FOR_REVIEW', objectKey: key, captionsKey: captionsKeyFor(key), chapters: out.chapters as unknown as Prisma.InputJsonValue, durationSeconds: out.durationSeconds },
      });
      await releaseReservation(tx, run);
      await writeAudit(tx, { clientId: run.clientId, ...SYSTEM_ACTOR }, {
        entityType: 'TemplateTutorialRun',
        entityId: runId,
        action: 'template.tutorial_generated',
        after: { status: 'READY_FOR_REVIEW', templateId: run.templateId, chapters: out.chapters.length, durationSeconds: out.durationSeconds, actualUsd: num(r.actualUsd), scriptModel: p.script.model, videoModel: p.clips.model },
      });
    });
  } catch (e) {
    const error = e instanceof TutorialCapError || e instanceof Error ? e.message.slice(0, 500) : 'The generation failed.';
    await db.$transaction(async (tx) => {
      const r = await tx.templateTutorialRun.update({ where: { id: runId }, data: { status: 'FAILED', error } });
      await releaseReservation(tx, run);
      await writeAudit(tx, { clientId: run.clientId, ...SYSTEM_ACTOR }, { entityType: 'TemplateTutorialRun', entityId: runId, action: 'template.tutorial_failed', after: { status: 'FAILED', error, actualUsd: num(r.actualUsd) } });
    });
  }
}

/** Admin approval: the run's video goes on its template version and the later versions of the workflow. */
export async function approveTutorialRun(tx: Tx, clientId: string, runId: string, adminId: string, audit: (i: AuditInput) => Promise<void>) {
  const run = await tx.templateTutorialRun.findFirst({ where: { id: runId, clientId }, include: { template: true } });
  if (!run) throw new AppError(404, 'NOT_FOUND', 'Tutorial run not found');
  if (run.status !== 'READY_FOR_REVIEW' || !run.objectKey) throw new AppError(409, 'NOT_READY', `Only a video waiting for approval can be approved (this one is ${run.status}).`);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`template:${run.lineageId}`}))`;
  const chapters = Chapters.safeParse(run.chapters).data ?? [];
  const superseded = await tx.templateTutorialRun.updateMany({ where: { clientId, lineageId: run.lineageId, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
  const decided = await tx.templateTutorialRun.update({ where: { id: run.id }, data: { status: 'APPROVED', decidedBy: adminId, decidedAt: new Date() } });
  const before = await tx.template.findMany({ where: { clientId, lineageId: run.lineageId, version: { gte: run.template.version } }, select: { id: true, version: true, tutorialVideoUrl: true } });
  await tx.template.updateMany({
    where: { clientId, lineageId: run.lineageId, version: { gte: run.template.version } },
    data: { tutorialVideoUrl: `${STORAGE_PREFIX}${run.objectKey}`, tutorialChapters: chapters as unknown as Prisma.InputJsonValue },
  });
  await audit({
    entityType: 'TemplateTutorialRun',
    entityId: run.id,
    action: 'template.tutorial_approved',
    before: { status: run.status, previous: before.map((b) => ({ version: b.version, videoUrl: b.tutorialVideoUrl })) },
    after: { status: 'APPROVED', templateId: run.templateId, versions: before.map((b) => b.version), superseded: superseded.count, chapters },
  });
  return decided;
}

/** Admin rejection: nothing changes on the template; the approved video (if any) stays. */
export async function rejectTutorialRun(tx: Tx, clientId: string, runId: string, adminId: string, reason: string, audit: (i: AuditInput) => Promise<void>) {
  const run = await tx.templateTutorialRun.findFirst({ where: { id: runId, clientId } });
  if (!run) throw new AppError(404, 'NOT_FOUND', 'Tutorial run not found');
  if (run.status !== 'READY_FOR_REVIEW') throw new AppError(409, 'NOT_READY', `Only a video waiting for approval can be rejected (this one is ${run.status}).`);
  const decided = await tx.templateTutorialRun.update({ where: { id: run.id }, data: { status: 'REJECTED', decidedBy: adminId, decidedAt: new Date(), rejectReason: reason } });
  await audit({ entityType: 'TemplateTutorialRun', entityId: run.id, action: 'template.tutorial_rejected', before: { status: run.status }, after: { status: 'REJECTED', reason } });
  return decided;
}

/** A run for the Admin console; preview addresses only while it has a video. */
export async function toRunDto(run: TemplateTutorialRun & { template: { version: number } }, storage: SignedUrlStorage | null): Promise<TutorialRunDto> {
  const sign = async (key: string | null) => (key && storage ? storage.signedUrl(key, 'read', { expiresInSeconds: 3600 }).catch(() => null) : null);
  const viewable = ['READY_FOR_REVIEW', 'APPROVED', 'SUPERSEDED', 'REJECTED'].includes(run.status);
  return {
    id: run.id,
    templateId: run.templateId,
    templateVersion: run.template.version,
    trigger: run.trigger,
    status: run.status,
    videoModel: run.videoModel,
    scriptModel: run.scriptModel,
    estimatedUsd: num(run.estimatedUsd),
    actualUsd: num(run.actualUsd),
    durationSeconds: run.durationSeconds,
    chapters: Chapters.safeParse(run.chapters ?? []).data ?? [],
    script: TutorialScript.safeParse(run.script).data ?? null,
    previewUrl: viewable ? await sign(run.objectKey) : null,
    captionsUrl: viewable ? await sign(run.captionsKey) : null,
    error: run.error,
    rejectReason: run.rejectReason,
    decidedAt: run.decidedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

// ── Serving the approved video to SMEs and Reviewers ──

let mediaStorage: SignedUrlStorage | null = null;
/** Set once when the app starts: the private bucket that holds generated videos. */
export function setTutorialMediaStorage(s: SignedUrlStorage | null) {
  mediaStorage = s;
}

/**
 * The template's tutorial as SMEs and Reviewers get it. A generated video (`storage:` address) becomes a short-lived
 * signed address with captions; a manually set address is returned as it is. If signing fails, no tutorial is shown
 * rather than a broken page.
 */
export async function servedTutorial(tutorial: Tutorial | null): Promise<Tutorial | null> {
  if (!tutorial || !tutorial.videoUrl.startsWith(STORAGE_PREFIX)) return tutorial;
  if (!mediaStorage) return null;
  const key = tutorial.videoUrl.slice(STORAGE_PREFIX.length);
  try {
    const videoUrl = await mediaStorage.signedUrl(key, 'read', { expiresInSeconds: SIGNED_URL_SECONDS });
    const captionsUrl = await mediaStorage.signedUrl(captionsKeyFor(key), 'read', { expiresInSeconds: SIGNED_URL_SECONDS }).catch(() => undefined);
    return { videoUrl, chapters: tutorial.chapters, ...(captionsUrl ? { captionsUrl } : {}) };
  } catch {
    return null;
  }
}
