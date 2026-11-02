/** Bounded server-side same-origin API proxy. No request may choose its upstream host. */
export const JSON_REQUEST_LIMIT = 1024 * 1024;
export const MULTIPART_REQUEST_LIMIT = 10 * 1024 * 1024 + 64 * 1024;

export async function proxyApi(request: Request, apiBase: string, fetcher: typeof fetch = fetch): Promise<Response> {
  const incoming = request.headers.get('x-request-id');
  const requestId = incoming && /^[\w-]{1,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  const error = (status: number, code: string, message: string) => Response.json(
    { error: code, message, requestId },
    { status, headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } },
  );
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/v1/') || /%00/i.test(url.pathname)) return error(400, 'INVALID_ADDRESS', 'This address is invalid.');
  let upstream: URL;
  try {
    const origin = new URL(apiBase);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || !['', '/'].includes(origin.pathname)) throw new Error();
    upstream = new URL(url.pathname + url.search, origin);
  } catch { return error(502, 'SERVICE_UNAVAILABLE', 'The service is not available. Please try again later.'); }
  const multipart = request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data');
  const limit = multipart ? MULTIPART_REQUEST_LIMIT : JSON_REQUEST_LIMIT;
  if (Number(request.headers.get('content-length') || 0) > limit) return error(413, 'REQUEST_TOO_LARGE', 'This request is too large. Reduce its size and try again.');
  let body: ArrayBuffer | undefined;
  if (request.body && !['GET', 'HEAD'].includes(request.method)) {
    const reader = request.body.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > limit) {
          await reader.cancel();
          return error(413, 'REQUEST_TOO_LARGE', 'This request is too large. Reduce its size and try again.');
        }
        chunks.push(next.value);
      }
    } catch { return error(400, 'BAD_REQUEST', 'This request could not be read. Please try again.'); }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (length) body = bytes.buffer;
  }
  const headers = new Headers(request.headers);
  for (const name of ['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer']) headers.delete(name);
  headers.set('x-request-id', requestId);
  try {
    const options: NonNullable<Parameters<typeof fetch>[1]> & { cache: 'no-store' } = { method: request.method, headers, body, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30_000) };
    const response = await fetcher(upstream, options);
    const out = new Headers(response.headers);
    // Fetch decodes compressed bodies; never forward the old compressed byte count/encoding.
    for (const name of ['content-length', 'content-encoding', 'connection', 'transfer-encoding']) out.delete(name);
    out.set('x-request-id', response.headers.get('x-request-id') || requestId);
    out.set('cache-control', 'no-store');
    return new Response(response.body, { status: response.status, headers: out });
  } catch { return error(502, 'SERVICE_UNAVAILABLE', 'Could not reach the service. Please try again later.'); }
}
