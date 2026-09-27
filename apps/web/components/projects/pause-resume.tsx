'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/client-api';

export function PauseResumeButton({ projectId, paused }: { projectId: string; paused: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const res = await mutate('POST', `/projects/${projectId}/${paused ? 'resume' : 'pause'}`);
          setPending(false);
          if (!res.ok) return setError(res.error);
          router.refresh();
        }}
        className="btn btn-secondary disabled:opacity-60"
      >
        {paused ? 'Resume project' : 'Pause project'}
      </button>
      {!paused && <span className="ml-2 text-xs text-fg-muted">Experts keep their saved work while paused.</span>}
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
