import Link from 'next/link';

/** Shown for a stopped or failed deployment (S3-10): no task data, no controls. */
export function StudioClosed({ workflowName, status }: { workflowName: string | null; status: 'STOPPED' | 'FAILED' }) {
  return (
    <section className="card mx-auto mt-10 max-w-xl p-6" aria-labelledby="studio-closed-title">
      <span className="pill pill-error">{status === 'STOPPED' ? 'Stopped' : 'Unavailable'}</span>
      <h1 id="studio-closed-title" className="mt-3 text-2xl font-semibold">
        This studio is closed
      </h1>
      <p className="mt-2 text-fg-muted">
        {workflowName ? `The ${workflowName} studio` : 'This studio'} is no longer taking new work. Tasks you already committed are kept and still go
        through review. If you expected to work here, contact your project manager.
      </p>
      <Link href="/home" className="btn btn-secondary mt-4">
        Back to home
      </Link>
    </section>
  );
}
