import type { TutorialVideo } from '@/lib/tutorials';

const src = (file: string) => `/tutorials/files/${file}`;

export function VideoGrid({ videos, label }: { videos: TutorialVideo[]; label: string }) {
  return (
    <section aria-label={label} className="grid gap-5 sm:grid-cols-2">
      {videos.map((v) => (
        <article key={v.file} className="card min-w-0 overflow-hidden">
          <video controls preload="metadata" src={src(v.file)} aria-label={`${v.title} video`} className="block aspect-[16/10] w-full bg-black" />
          <div className="space-y-1 p-4">
            <p className="font-mono text-xs text-fg-muted">{v.length} · captions, no sound</p>
            <h3 className="font-semibold">{v.title}</h3>
            <p className="text-sm text-fg-muted">{v.summary}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

export function GuideCard({ file, title, summary }: { file: string; title: string; summary: string }) {
  return (
    <section aria-labelledby="guide-h" className="card flex flex-wrap items-center gap-4 p-5">
      <div className="min-w-0 flex-1">
        <h2 id="guide-h" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">{summary}</p>
      </div>
      <a href={src(file)} target="_blank" rel="noopener" className="btn btn-primary">
        Open the guide
      </a>
    </section>
  );
}

export function RecordingNote() {
  return (
    <p className="text-xs text-fg-muted">
      The videos use synthetic data. Sign-in, the identity and selfie checks, email and payouts are simulated, as in every test environment.
    </p>
  );
}
