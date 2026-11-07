import { handleMock } from '@/lib/mc/mock-backend';
import { MC_API_MODE } from '@/lib/mc/mode';
import { mockContext } from '@/lib/mc/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Browser entry to the mock Meta-Compiler routes (lib/mc/mode.ts). Gone in live mode. */
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (MC_API_MODE !== 'mock') return Response.json({ error: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
  const ctx = await mockContext();
  if (ctx.roles.length === 0) return Response.json({ error: 'UNAUTHENTICATED', message: 'Sign in first' }, { status: 401 });
  const body = request.method === 'GET' ? undefined : await request.json().catch(() => ({}));
  const r = await handleMock(request.method, `/${(await params).path.join('/')}`, body, ctx);
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store', ...r.headers } });
}

export { handle as GET, handle as POST, handle as PUT };
