import { roleLabel } from '@praxis/shared';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/api';

/**
 * Shown instead of a bare 404 when the signed-in role can't use a page. The console keeps one sign-in per browser, so
 * signing in as someone else in another tab switches every tab to that account.
 */
export async function NoAccess({ need }: { need: string }) {
  const user = (await getCurrentUser())!;
  return (
    <div className="card mx-auto mt-6 max-w-xl p-6">
      <span className="pill pill-warning">No access</span>
      <h1 className="mt-3 text-xl font-bold">This page is for {need}</h1>
      <p className="mt-2 text-fg-muted">
        You’re signed in as <span className="font-semibold text-fg">{user.name}</span> ({user.roles.map(roleLabel).join(', ')}).
      </p>
      <p className="mt-2 text-sm text-fg-muted">
        One browser holds one sign-in: signing in with another account in a different tab switches this tab too. Use a separate browser or a private window for each role.
      </p>
      <Link href="/" className="btn btn-primary mt-5">Go to your home page</Link>
    </div>
  );
}
