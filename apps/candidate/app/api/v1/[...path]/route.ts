import { proxyApi } from '@praxis/shared/api-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = (request: Request) => proxyApi(request, process.env.API_BASE_URL ?? 'http://localhost:4000');
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS, handle as HEAD };
