import { TutorialChapter, type Tutorial } from '@praxis/shared';
import { z } from 'zod';

const Chapters = z.array(TutorialChapter);

/** MVP1 step 7: a template's tutorial video and chapters, or null when it has none. */
export function tutorialOf(t: { tutorialVideoUrl: string | null; tutorialChapters: unknown }): Tutorial | null {
  if (!t.tutorialVideoUrl) return null;
  return { videoUrl: t.tutorialVideoUrl, chapters: Chapters.safeParse(t.tutorialChapters ?? []).data ?? [] };
}

