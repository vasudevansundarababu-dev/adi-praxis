import { z } from 'zod';

/**
 * MVP1 step 7: the Tutorial linked to the task's template, and Help scoped to the task
 * (docs/design/PROJECT-SCREEN-DESIGN.md, "Candidate app for MVP1").
 */

export const TutorialChapter = z.object({ title: z.string().trim().min(1).max(100), at: z.number().int().min(0).max(86_400) }).strict();
export type TutorialChapter = z.infer<typeof TutorialChapter>;

/** `captionsUrl`: WebVTT captions of a generated (D2) video; absent for a manually set address. */
export const Tutorial = z.object({ videoUrl: z.string(), chapters: z.array(TutorialChapter), captionsUrl: z.string().optional() });
export type Tutorial = z.infer<typeof Tutorial>;

/** PUT /templates/:id/tutorial (Admin). `videoUrl: null` clears the tutorial. */
export const SetTutorialRequest = z
  .object({
    videoUrl: z
      .string()
      .trim()
      .max(500)
      .url()
      .refine((u) => u.startsWith('https://'), 'The video address must start with https://')
      .nullable(),
    chapters: z.array(TutorialChapter).max(20).optional(),
  })
  .strict();
export type SetTutorialRequest = z.infer<typeof SetTutorialRequest>;

/** How the candidate app shows a tutorial: an HTML5 video for common video files, otherwise a link; none when unset. */
export function tutorialKind(t: { videoUrl: string } | null | undefined): 'video' | 'link' | 'none' {
  if (!t?.videoUrl) return 'none';
  let path = t.videoUrl;
  try {
    path = new URL(t.videoUrl).pathname;
  } catch {
    /* keep the raw string */
  }
  return /\.(mp4|webm|mov)$/i.test(path) ? 'video' : 'link';
}

/** mm:ss (or h:mm:ss) for a chapter time in seconds. */
export function chapterTime(at: number): string {
  const h = Math.floor(at / 3600);
  const m = Math.floor((at % 3600) / 60);
  const s = at % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Parses mm:ss, h:mm:ss or plain seconds; null when it is not a time. */
export function parseChapterTime(v: string): number | null {
  const parts = v.trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n > 59)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** The exact sentence Help answers with for anything outside the task. */
export const TASK_HELP_REFUSAL = 'I can only help with this task and its form. Ask me about a section, the rules for this case, or how to submit.';

/** POST /me/tasks/:id/help and POST /me/reviews/:taskId/help. */
export const TaskHelpRequest = z
  .object({
    question: z.string().trim().min(1).max(1000),
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }).strict()).max(10).default([]),
  })
  .strict();
export type TaskHelpRequest = z.infer<typeof TaskHelpRequest>;

export const TASK_HELP_SUGGESTIONS = {
  author: ['What goes in S1?', 'Which rules apply to this case?', 'What does the reviewer’s comment ask me to change?', 'How do I submit?'],
  reviewer: ['What should I check in S1?', 'Which rules apply to this case?', 'What makes a good rubric criterion?', 'How do I send it back or approve it?'],
} as const;

// ───────────── D2: AI-generated tutorial videos (docs/plan/PLAN-D2-TUTORIAL-VIDEO.md) ─────────────

export const TUTORIAL_RUN_STATUSES = ['QUEUED', 'SCRIPTING', 'CLIPS', 'NARRATION', 'STITCHING', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'FAILED'] as const;
export type TutorialRunStatus = (typeof TUTORIAL_RUN_STATUSES)[number];
/** Runs still working or waiting for an Admin; only one per workflow at a time. */
export const OPEN_TUTORIAL_RUN_STATUSES: readonly TutorialRunStatus[] = ['QUEUED', 'SCRIPTING', 'CLIPS', 'NARRATION', 'STITCHING', 'READY_FOR_REVIEW'];

/** One on-screen card: a field, what it needs, and a good (synthetic) answer. */
export const TutorialCard = z.object({ label: z.string().min(1).max(120), need: z.string().min(1).max(400), example: z.string().max(400) }).strict();
export type TutorialCard = z.infer<typeof TutorialCard>;

/** One chapter of the narration script (the drafter's output, validated). */
export const TutorialScriptChapter = z
  .object({
    title: z.string().trim().min(1).max(100),
    narration: z.string().trim().min(1).max(1200),
    cards: z.array(TutorialCard).max(30),
    /** Two text-free scene prompts for the video model. */
    scenes: z.array(z.string().trim().min(1).max(600)).length(2),
  })
  .strict();
export type TutorialScriptChapter = z.infer<typeof TutorialScriptChapter>;
export const TutorialScript = z.object({ chapters: z.array(TutorialScriptChapter).min(2).max(12) }).strict();
export type TutorialScript = z.infer<typeof TutorialScript>;

export const TutorialRunDto = z.object({
  id: z.string(),
  templateId: z.string(),
  templateVersion: z.number().int(),
  trigger: z.enum(['PUBLISH', 'ADMIN']),
  status: z.enum(TUTORIAL_RUN_STATUSES),
  videoModel: z.string(),
  scriptModel: z.string(),
  estimatedUsd: z.number(),
  actualUsd: z.number(),
  durationSeconds: z.number().int().nullable(),
  chapters: z.array(TutorialChapter),
  script: TutorialScript.nullable(),
  /** Short-lived preview addresses, only for an Admin and only while the run has a video. */
  previewUrl: z.string().nullable(),
  captionsUrl: z.string().nullable(),
  error: z.string().nullable(),
  rejectReason: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TutorialRunDto = z.infer<typeof TutorialRunDto>;

/** GET /templates/:id/tutorial/runs: the runs plus what the Generate button needs to show first. */
export const TutorialRunsResponse = z.object({
  runs: z.array(TutorialRunDto),
  generation: z.object({
    /** Null when generation can start; otherwise why not, in plain words. */
    blockedReason: z.string().nullable(),
    live: z.boolean(),
    estimatedUsd: z.number(),
    spentTodayUsd: z.number(),
    costCapUsd: z.number().nullable(),
    dailyCapUsd: z.number().nullable(),
    chapters: z.number().int(),
  }),
});
export type TutorialRunsResponse = z.infer<typeof TutorialRunsResponse>;

export const RejectTutorialRequest = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
export type RejectTutorialRequest = z.infer<typeof RejectTutorialRequest>;

/** Names that must never be spoken or shown to users (legal rule): the product is ADI Forge, Anvil is RL Gym. */
export const BANNED_PUBLIC_NAMES = /praxis|anvil|adi[-\s]?labs/i;
