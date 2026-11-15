'use client';

import { chapterTime, parseChapterTime, type TemplateDto, type Tutorial } from '@praxis/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

type Row = { title: string; time: string };
const rowsOf = (t: Tutorial | null | undefined): Row[] => (t?.chapters ?? []).map((c) => ({ title: c.title, time: chapterTime(c.at) }));

/** What is wrong with the form before it is sent, or null. */
export function tutorialFormProblem(url: string, rows: Row[]): string | null {
  const u = url.trim();
  if (!u) return rows.some((r) => r.title.trim()) ? 'Add the video address, or remove the chapters.' : null;
  if (!u.startsWith('https://')) return 'The video address must start with https://';
  if (u.length > 500) return 'The video address can be at most 500 characters.';
  if (rows.length > 20) return 'At most 20 chapters.';
  for (const [i, r] of rows.entries()) {
    if (!r.title.trim()) return `Chapter ${i + 1} needs a title.`;
    if (r.title.trim().length > 100) return `Chapter ${i + 1}: the title can be at most 100 characters.`;
    if (parseChapterTime(r.time) === null) return `Chapter ${i + 1}: write the time as mm:ss, for example 2:30.`;
  }
  return null;
}

/**
 * MVP1 step 7: the template's tutorial video, shown on every task of this template in the candidate app. Admins set
 * the address and chapters; everyone else sees the current value read-only.
 */
export function TutorialSettings({ template, canEdit }: { template: Pick<TemplateDto, 'id' | 'tutorial'>; canEdit: boolean }) {
  const router = useRouter();
  const current = template.tutorial ?? null;
  const [url, setUrl] = useState(current?.videoUrl ?? '');
  const [rows, setRows] = useState<Row[]>(rowsOf(current));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const input = 'mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm';

  async function save() {
    const problem = tutorialFormProblem(url, rows);
    setSaved(false);
    if (problem) return setError(problem);
    setError(null);
    setPending(true);
    const videoUrl = url.trim() || null;
    const res = await mutate<TemplateDto>('PUT', `/templates/${template.id}/tutorial`, { videoUrl, ...(videoUrl ? { chapters: rows.map((r) => ({ title: r.title.trim(), at: parseChapterTime(r.time)! })) } : {}) });
    setPending(false);
    if (!res.ok) return setError(res.error);
    setRows(rowsOf(res.data?.tutorial));
    setSaved(true);
    router.refresh();
  }

  return (
    <section aria-labelledby="tutorial-h" className="card mt-4 p-4">
      <h2 id="tutorial-h" className="text-base font-semibold">
        Tutorial video
      </h2>
      <p className="mt-1 text-sm text-fg-muted">Shown on every task of this template in the candidate app, for every version. It is not part of the task contract, so saving it does not create a new version.</p>
      {!canEdit ? (
        current ? (
          <div className="mt-3 text-sm">
            <a href={current.videoUrl} target="_blank" rel="noopener noreferrer" className="break-all text-link hover:underline">
              {current.videoUrl}
            </a>
            {current.chapters.length > 0 && (
              <ol className="mt-2 list-inside list-decimal space-y-0.5">
                {current.chapters.map((c, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs">{chapterTime(c.at)}</span> {c.title}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm">No tutorial video yet.</p>
        )
      ) : (
        <div className="mt-3 space-y-3">
          <label className="block text-sm">
            Video address (https)
            <input type="url" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/tutorial.mp4" className={input} />
            <span className="block text-xs text-fg-muted">An .mp4, .webm or .mov file plays on the task page; any other address opens in a new tab. Leave it empty and save to remove the tutorial.</span>
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Chapters</legend>
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className="block grow text-sm">
                  Chapter {i + 1} title
                  <input value={r.title} maxLength={100} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={input} />
                </label>
                <label className="block w-24 text-sm">
                  Starts at (mm:ss)
                  <input value={r.time} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} placeholder="0:00" className={input} />
                </label>
                <button type="button" className="btn btn-secondary" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove chapter ${i + 1}`}>
                  Remove
                </button>
              </div>
            ))}
            {rows.length < 20 && (
              <button type="button" className="text-sm text-link underline" onClick={() => setRows([...rows, { title: '', time: '' }])}>
                Add a chapter
              </button>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          {saved && <p role="status" className="text-sm text-fg-muted">Saved.</p>}
          <button type="button" className="btn btn-primary disabled:opacity-60" disabled={pending} onClick={() => void save()}>
            Save
          </button>
        </div>
      )}
    </section>
  );
}
