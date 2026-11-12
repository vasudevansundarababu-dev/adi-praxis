import { describe, expect, it } from 'vitest';
import { AnvilExportClient, type FetchLike } from '../src/anvil/export-client';
import { AnvilGatedValidator, type ValidationItem } from '../src/anvil/validator';

/** Anvil dataset-export client (Praxis-Anvil contract). A fake transport only: no network, no paid calls. */
const TOKEN = 'anvil-test-token-0123456789abcdef';
const BASE = 'https://anvil-qa.example.test/api/v1/projects/p1/dataset-exports';

function fake(status: number, body: unknown, seen: { url: string; init: Parameters<FetchLike>[1] }[] = []): FetchLike {
  return async (url, init) => {
    seen.push({ url, init });
    return { status, headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

describe('Anvil export client', () => {
  it('sends a raw ZIP with the bearer token only (no cookies or CSRF); resolve carries the Idempotency-Key', async () => {
    const seen: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const c = new AnvilExportClient(BASE, TOKEN, fake(200, { data: { status: 'export_valid', valid: true }, meta: { request_id: 'r1' } }, seen));
    await c.validate(zip);
    await c.resolve(zip, 'praxis-pkg-abc');
    expect(seen.map((s) => s.url)).toEqual([`${BASE}/validate`, `${BASE}/resolve`]);
    expect(seen[0]!.init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/zip' });
    expect(seen[1]!.init.headers['Idempotency-Key']).toBe('praxis-pkg-abc');
    expect(Object.keys(seen[0]!.init.headers).some((h) => /cookie|csrf|origin/i.test(h))).toBe(false);
    expect(seen[0]!.init.body).toBe(zip);
  });

  it('business results keep Anvil status, validity, errors and request ID; valid:true is never invented', async () => {
    const invalid = await new AnvilExportClient(BASE, TOKEN, fake(422, { data: { status: 'export_invalid', valid: false, errors: [{ code: 'PX_FILE_MISSING', file: 'tasks/x.json', pointer: '', message: 'm', fix: 'f' }], anvil_requirements: [], review_gates: [] }, meta: { request_id: 'r2' } })).validate(zip);
    expect(invalid).toMatchObject({ kind: 'business', httpStatus: 422, status: 'export_invalid', valid: false, requestId: 'r2' });
    expect(await new AnvilExportClient(BASE, TOKEN, fake(202, { data: { status: 'anvil_provisioning', valid: true } })).resolve(zip, 'k')).toMatchObject({ kind: 'business', httpStatus: 202, status: 'anvil_provisioning' });
    expect(await new AnvilExportClient(BASE, TOKEN, fake(409, { data: { status: 'anvil_blocked', valid: true } })).resolve(zip, 'k')).toMatchObject({ kind: 'business', status: 'anvil_blocked' });
  });

  it('auth, availability, key conflicts, internal errors, network and timeouts are not package errors', async () => {
    const err = (s: number) => new AnvilExportClient(BASE, TOKEN, fake(s, { error: { code: 'X', message: 'm', request_id: 'r', retryable: false } })).validate(zip);
    expect((await err(401)).kind).toBe('auth');
    expect((await err(403)).kind).toBe('auth');
    expect((await err(404)).kind).toBe('unavailable');
    expect((await err(503)).kind).toBe('unavailable');
    expect((await err(409)).kind).toBe('conflict');
    expect((await err(413)).kind).toBe('transport');
    expect((await err(500)).kind).toBe('internal');
    expect(await new AnvilExportClient(BASE, TOKEN, fake(502, '<html>bad gateway</html>')).validate(zip)).toMatchObject({ kind: 'internal', code: 'HTTP_502' });
    const down: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    expect(await new AnvilExportClient(BASE, TOKEN, down).contracts()).toMatchObject({ kind: 'transport', code: 'NETWORK', retryable: true });
    const slow: FetchLike = (_u, init) => new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    expect(await new AnvilExportClient(BASE, TOKEN, slow, 20).contracts()).toMatchObject({ kind: 'transport', code: 'TIMEOUT' });
    const big = new Uint8Array(1_048_577);
    expect(await new AnvilExportClient(BASE, TOKEN, fake(200, {})).validate(big)).toMatchObject({ code: 'PACKAGE_TOO_LARGE' });
  });

  it('never echoes the token in any result', async () => {
    const r = await new AnvilExportClient(BASE, TOKEN, fake(401, { error: { code: 'UNAUTHENTICATED', message: 'bad token' } })).contracts();
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe('Anvil-gated validator', () => {
  const item = { record: { id: '00000000-0000-4000-8000-000000000001' }, taskId: '00000000-0000-4000-8000-000000000002', title: 'T', envelope: { schema_version: 'praxis.anvil.export.v1' }, exportProblems: [] } as unknown as ValidationItem;

  it('until Anvil advertises the generic contract, a task is "not validated" with the reason; never valid', async () => {
    const v = new AnvilGatedValidator(new AnvilExportClient(BASE, TOKEN, fake(200, { data: { contract: 'anvil.evaluator-task-export.v1', enabled: true } })));
    const [r] = await v.validate([item]);
    expect(r).toMatchObject({ status: 'not_validated', issues: [{ code: 'ANVIL_CONTRACT_UNAVAILABLE' }] });
  });

  it('generic support is the exact contract ID, never a similar name (Anvil Q3)', async () => {
    const similar = new AnvilGatedValidator(new AnvilExportClient(BASE, TOKEN, fake(200, { data: { contracts: [{ id: 'praxis.authored-task-export.v1-proposed' }, { id: 'praxis.authored-task-export.v10' }] } })));
    expect((await similar.validate([item]))[0]).toMatchObject({ status: 'not_validated', issues: [{ code: 'ANVIL_CONTRACT_UNAVAILABLE' }] });
    // Four confirmations, point 3: the exact ID in data.contracts AND data.enabled true; listed but off is not support.
    const off = new AnvilGatedValidator(new AnvilExportClient(BASE, TOKEN, fake(200, { data: { contracts: ['praxis.authored-task-export.v1'], contract: 'praxis.authored-task-export.v1', enabled: false } })));
    expect((await off.validate([item]))[0]).toMatchObject({ status: 'not_validated', issues: [{ code: 'ANVIL_CONTRACT_DISABLED' }] });
    const elsewhere = new AnvilGatedValidator(new AnvilExportClient(BASE, TOKEN, fake(200, { data: { contract: 'praxis.authored-task-export.v1', enabled: true, notes: ['praxis.authored-task-export.v1'] } })));
    expect((await elsewhere.validate([item]))[0]).toMatchObject({ status: 'not_validated', issues: [{ code: 'ANVIL_CONTRACT_UNAVAILABLE' }] });
  });

  it('an authentication failure is reported as such, not as a task problem', async () => {
    const v = new AnvilGatedValidator(new AnvilExportClient(BASE, TOKEN, fake(401, { error: { code: 'UNAUTHENTICATED', message: 'Expired export client.' } })));
    const [r] = await v.validate([item]);
    expect(r).toMatchObject({ status: 'not_validated', issues: [{ code: 'ANVIL_AUTH', message: 'Expired export client.' }] });
  });
});
