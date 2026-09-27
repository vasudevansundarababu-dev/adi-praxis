'use client';

import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

export function SignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-link hover:underline"
      onClick={async () => {
        await call('POST', '/me/logout');
        router.replace('/');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
