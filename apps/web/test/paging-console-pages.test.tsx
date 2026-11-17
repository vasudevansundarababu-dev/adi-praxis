import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// D24: console list pages show 10 rows per page with the shared pagination bar; the page lives in `?page=`.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }), notFound: () => { throw new Error('NOT_FOUND'); } }));
const api = vi.hoisted(() => ({ routes: {} as Record<string, unknown>, calls: [] as string[] }));
vi.mock('@/lib/api', () => ({
  apiGet: async (path: string) => {
    api.calls.push(path);
    return path in api.routes ? { status: 200, data: api.routes[path] } : { status: 404, data: null };
  },
  getCurrentUser: async () => ({ id: 'u1', name: 'Ada Admin', roles: ['ADMIN'] }),
}));
beforeEach(() => {
  api.routes = {};
  api.calls = [];
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const html = async (el: Promise<unknown>) => renderToStaticMarkup((await el) as React.ReactElement).replace(/&amp;/g, '&');

describe('Pay runs page (D24)', () => {
  const runs = Array.from({ length: 23 }, (_, i) => ({ id: id(i + 1), status: 'COMPLETED', periodStart: '2026-01-05T00:00:00Z', periodEnd: '2026-01-12T00:00:00Z', totals: {}, report: null }));

  it('shows 10 runs on page 1 with the count and page links', async () => {
    api.routes['/pay-runs'] = { items: runs };
    const { default: PayRunsPage } = await import('../app/(console)/payments/pay-runs/page');
    const out = await html(PayRunsPage({ searchParams: Promise.resolve({}) }));
    expect(out.match(/href="\/payments\/pay-runs\/0/g)).toHaveLength(10);
    expect(out).toContain('Showing 10 of 23 pay runs');
    expect(out).toContain('href="?page=2"');
    expect(out).toContain('href="?page=3"');
  });

  it('page 3 shows the last 3 runs', async () => {
    api.routes['/pay-runs'] = { items: runs };
    const { default: PayRunsPage } = await import('../app/(console)/payments/pay-runs/page');
    const out = await html(PayRunsPage({ searchParams: Promise.resolve({ page: '3' }) }));
    expect(out.match(/href="\/payments\/pay-runs\/0/g)).toHaveLength(3);
    expect(out).toContain('Showing 3 of 23 pay runs');
    expect(out).toContain(`/payments/pay-runs/${id(23)}`);
  });
});

describe('Requisitions page (D24)', () => {
  const reqs = Array.from({ length: 15 }, (_, i) => ({ id: id(i + 1), title: `Req ${i + 1}`, projectName: 'P', domain: 'kyc', tierLabel: 'Tier', headcount: 1, state: 'OPEN', payRoute: 'DIRECT', submissions: 0, submissionDeadline: null }));

  it('pages the list and keeps the state filter in the page links', async () => {
    api.routes['/requisitions?state=OPEN'] = { items: reqs };
    const { default: RequisitionsPage } = await import('../app/(console)/requisitions/page');
    const out = await html(RequisitionsPage({ searchParams: Promise.resolve({ state: 'OPEN', page: '2' }) }));
    expect(out.match(/href="\/requisitions\/0/g)).toHaveLength(5);
    expect(out).toContain('Showing 5 of 15 requisitions');
    expect(out).toContain('href="?state=OPEN"');
  });

  it('counts the search matches, not the whole list', async () => {
    api.routes['/requisitions'] = { items: reqs };
    api.routes['/search/requisitions?q=req&limit=1'] = { ids: [id(1), id(2), id(3)] };
    const { default: RequisitionsPage } = await import('../app/(console)/requisitions/page');
    const out = await html(RequisitionsPage({ searchParams: Promise.resolve({ q: 'req' }) }));
    expect(out.match(/href="\/requisitions\/0/g)).toHaveLength(3);
    expect(out).toContain('Showing 3 of 3 requisitions');
  });
});
