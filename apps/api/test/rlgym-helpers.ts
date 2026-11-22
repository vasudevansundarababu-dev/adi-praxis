import { templateVersionHash } from '../src/routes/anvil-templates';
import type { FetchLike } from '../src/anvil/rlgym-client';
import { db } from './helpers';

/**
 * Test helpers for the new RL Gym project export (part 2). Mocks only: the RL Gym is a recorded fake, never a live call.
 */

/** Settings that make ADI Forge "connected" to an RL Gym at a fake local address. */
export const RLGYM_CONFIG = { RLGYM_API_URL: 'http://127.0.0.1:8200', RLGYM_WORKSPACE: 'adi-labs-research', RLGYM_FORGE_CLIENT_KEY: 'test-rlgym-forge-key' } as const;

export interface SentExport {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

/**
 * A fake RL Gym: records every export it receives and answers with `answer` (default: a receipt counting every task as
 * new). Set `mode` to 'error' or 'down' to test failures.
 */
export function fakeRlGym() {
  const sent: SentExport[] = [];
  const state = { mode: 'ok' as 'ok' | 'error' | 'down', answer: null as null | ((body: Record<string, any>) => Record<string, unknown>) };
  const fetch: FetchLike = async (url, init) => {
    if (state.mode === 'down') throw new Error('connect ECONNREFUSED');
    const body = JSON.parse(init.body ?? '{}');
    sent.push({ url, headers: init.headers, body });
    if (state.mode === 'error') return { status: 422, text: async () => JSON.stringify({ error: { code: 'TEMPLATE_NOT_ACTIVE', message: 'Template is not active in this workspace', request_id: 'req-err' } }) };
    const data = state.answer
      ? state.answer(body)
      : url.includes('/sme-review-batches/')
        ? { batch_id: body.batch_id, state: 'decided', items: body.decisions.map((d: { item_id: string; decision: string }) => ({ item_id: d.item_id, decision: d.decision })) }
        : { project_id: body.project_id, export_id: body.export_id, new: body.tasks.length, superseding: 0, unchanged: 0, blocked: [], receipt_sha256: 'r'.repeat(64) };
    return { status: 201, text: async () => JSON.stringify({ data, meta: { request_id: `req-${sent.length}` } }) };
  };
  return { fetch, sent, state };
}

/** Records the RL Gym's qualification of a published template version, as its qualification call would. */
export async function qualifyForRlGym(templateId: string, ref = { id: 'tpl_x5rwt6d5eu', version: 9, spec: 's'.repeat(64) }) {
  const t = await db.template.findUniqueOrThrow({ where: { id: templateId } });
  const client = await db.apiClient.findFirst({ where: { clientId: t.clientId } });
  const apiClientId = client?.id ?? (await db.apiClient.create({ data: { clientId: t.clientId, name: 'RL Gym (test)', kind: 'ANVIL', keyHash: `test-${templateId}` } })).id;
  await db.templateQualification.create({
    data: { clientId: t.clientId, templateId: t.id, templateVersionHash: templateVersionHash(t), status: 'QUALIFIED', receiptId: `tq-${templateId.slice(0, 8)}`, receipt: { rlgym_template_id: ref.id, rlgym_template_version: ref.version, spec_sha256: ref.spec }, apiClientId },
  });
  return ref;
}

/** Settings that make ADI Forge "connected" to a local Studio through its trusted service headers. */
export const STUDIO_CONFIG = { STUDIO_API_URL: 'http://127.0.0.1:8000', STUDIO_TENANT_ID: '3981732d-51f5-5fd2-a151-ec2b6687a27d', STUDIO_SERVICE_ACTOR_ID: '00000000-0000-5000-8000-0000000a11ce' } as const;

/** A fake Studio inbox: records each item and answers 202 {id}, or an error when `mode` says so. */
export function fakeStudio() {
  const sent: SentExport[] = [];
  const state = { mode: 'ok' as 'ok' | 'error' | 'down' };
  const fetch: FetchLike = async (url, init) => {
    if (state.mode === 'down') throw new Error('connect ECONNREFUSED');
    const body = JSON.parse(init.body ?? '{}');
    sent.push({ url, headers: init.headers, body });
    if (state.mode === 'error') return { status: 422, text: async () => JSON.stringify({ code: 'VALIDATION_FAILED', message: 'Extra inputs are not permitted' }) };
    return { status: 202, text: async () => JSON.stringify({ id: `inb-${String(41 + sent.length).padStart(4, '0')}` }) };
  };
  return { fetch, sent, state };
}
