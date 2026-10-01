import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getCurrentUser } from '@/lib/api';
import { getPartnerMe } from '@/lib/partner-api';
import { tutorialFilesFor } from '@/lib/tutorials';

/**
 * Tutorial videos and guides for signed-in users only: console users get the staff files, partner users the partner
 * files. Supports Range requests so videos can seek. Files are in apps/web/tutorials (dev: cwd apps/web; the
 * standalone image runs from /app with the folder copied to apps/web/tutorials).
 */
const DIRS = [path.join(process.cwd(), 'tutorials'), path.join(process.cwd(), 'apps/web/tutorials')];
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.pdf': 'application/pdf' };

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const allowed = new Set<string>();
  if (await getCurrentUser()) tutorialFilesFor('staff').forEach((f) => allowed.add(f));
  else if (await getPartnerMe()) tutorialFilesFor('partner').forEach((f) => allowed.add(f));
  if (!allowed.size) return new Response('Sign in to watch the tutorials.', { status: 401 });
  if (!allowed.has(file)) return new Response('Not found', { status: 404 });
  const dir = DIRS.find((d) => existsSync(path.join(d, file)));
  if (!dir) return new Response('Not found', { status: 404 });
  const full = path.join(dir, file);
  const size = statSync(full).size;
  const headers: Record<string, string> = { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, { status: 200, headers: { ...headers, 'content-length': String(size) } });
}
