'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call } from '@/lib/client';

export function NextTaskButton({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="text-right">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const r = await call<{ id: string }>('POST', `/me/projects/${projectId}/tasks/next`);
          setPending(false);
          if (r.ok) router.push(`/tasks/${r.data!.id}`);
          else setError(r.error);
        }}
        className="btn btn-primary disabled:opacity-50"
      >
        Get next task
      </button>
      {error && <p role="alert" className="mt-1 max-w-xs text-sm text-error">{error}</p>}
    </div>
  );
}
