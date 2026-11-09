import { getMe } from '@/lib/api';
import { handleStudioMock } from '@/lib/studio/mock-backend';
import { STUDIO_API_MODE } from '@/lib/studio/mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Browser entry to the mock studio routes (lib/studio/mode.ts). Gone in live mode. */
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (STUDIO_API_MODE !== 'mock') return Response.json({ error: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
  const me = await getMe();
  const body = request.method === 'GET' ? undefined : await request.json().catch(() => ({}));
  const r = handleStudioMock(request.method, `/${(await params).path.join('/')}`, body, { smeUserId: me?.id ?? null }, request.headers.get('idempotency-key'));
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
}

export { handle as GET, handle as POST, handle as PUT };
