import { z } from 'zod';

/**
 * MVP1 step 7: the Tutorial linked to the task's template, and Help scoped to the task
 * (docs/design/PROJECT-SCREEN-DESIGN.md, "Candidate app for MVP1").
 */

export const TutorialChapter = z.object({ title: z.string().trim().min(1).max(100), at: z.number().int().min(0).max(86_400) }).strict();
export type TutorialChapter = z.infer<typeof TutorialChapter>;

export const Tutorial = z.object({ videoUrl: z.string(), chapters: z.array(TutorialChapter) });
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
