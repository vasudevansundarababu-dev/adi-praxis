import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { elapsed, formatDuration, isActive, pollExtraction, stageLabel } from '@/components/policy/extraction-progress';
import { PolicyWorkspace, type ExtractionData, type Job } from '@/components/policy/policy-workspace';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1',
  status: 'QUEUED',
  provider: 'llamaextract',
  documentVersionId: 'dv1',
  document: '01-CA-KYC-state-addendum.md',
  documentVersion: 1,
  candidateCount: 0,
  error: null,
  createdAt: '2026-11-14T10:00:00Z',
  startedAt: null,
  finishedAt: null,
  submitted: false,
  ...over,
});
const data = (jobs: Job[]): ExtractionData => ({
  profile: { id: 'llama-agentic-v1', label: 'LlamaExtract — Agentic', provider: 'llamaextract', revision: 8, source: 'project' },
  available: true,
  problems: [],
  budget: null,
  batches: [{ id: 'b1', status: 'QUEUED', profileId: 'llama-agentic-v1', profileRevision: 8, selectionSource: 'project', parentBatchId: null, createdAt: '2026-11-14T10:00:00Z', jobs }],
});

describe('Issue 1: extraction progress (PR-E15)', () => {
  it('labels each stage: Queued, Running (sending / waiting for the provider) and the final states', () => {
    expect(stageLabel(job())).toBe('Queued');
    expect(stageLabel(job({ status: 'PROCESSING' }))).toBe('Running — sending to the provider');
    expect(stageLabel(job({ status: 'PROCESSING', submitted: true }))).toBe('Running — waiting for the provider');
    expect(stageLabel(job({ status: 'SUCCEEDED' }))).toBe('Succeeded');
    expect(stageLabel(job({ status: 'FAILED' }))).toBe('Failed');
  });

  it('shows elapsed time: counting while running, fixed once finished', () => {
    const now = Date.parse('2026-11-14T10:01:05Z');
    expect(elapsed(job({ status: 'PROCESSING' }), now)).toBe('1m 05s');
    expect(elapsed(job({ status: 'SUCCEEDED', finishedAt: '2026-11-14T10:00:42Z' }), now)).toBe('42s');
    expect(elapsed(job({ createdAt: null }), now)).toBeNull();
    expect(formatDuration(3_725_000)).toBe('1h 02m');
  });

  it('is active only while a job is not terminal', () => {
    expect(isActive([job(), job({ status: 'SUCCEEDED' })])).toBe(true);
    expect(isActive([job({ status: 'SUCCEEDED' }), job({ status: 'FAILED' }), job({ status: 'UNCERTAIN' })])).toBe(false);
  });

  it('polls until every job is terminal, then stops and reports done once', async () => {
    const responses = [data([job()]), null, data([job({ status: 'PROCESSING', submitted: true })]), data([job({ status: 'SUCCEEDED', candidateCount: 148 })])];
    const fetchOnce = vi.fn(async () => responses.shift() ?? null);
    const updates: ExtractionData[] = [];
    const onDone = vi.fn();
    const r = await pollExtraction({ fetchOnce, onUpdate: (d) => updates.push(d), onDone, sleep: async () => undefined });
    expect(r).toBe('done');
    expect(fetchOnce).toHaveBeenCalledTimes(4);
    expect(updates.map((u) => u.batches[0]!.jobs[0]!.status)).toEqual(['QUEUED', 'PROCESSING', 'SUCCEEDED']);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stops when the page is left and gives up after the deadline', async () => {
    const signal = { aborted: false };
    const aborted = await pollExtraction({ signal, fetchOnce: async () => data([job()]), onUpdate: () => (signal.aborted = true), onDone: () => undefined, sleep: async () => undefined });
    expect(aborted).toBe('aborted');
    let t = 0;
    const gaveUp = await pollExtraction({ fetchOnce: async () => data([job()]), onUpdate: () => undefined, onDone: () => undefined, sleep: async () => undefined, now: () => (t += 60_000), giveUpMs: 300_000 });
    expect(gaveUp).toBe('gave_up');
  });

  it('renders live receipts with stage, candidates and elapsed time, and no "refresh" instruction', () => {
    const html = renderToStaticMarkup(
      <PolicyWorkspace
        projectId="p1"
        isAdmin={false}
        documents={{ maxPages: 20, items: [] }}
        extraction={data([job({ status: 'PROCESSING', submitted: true }), job({ id: 'j2', status: 'SUCCEEDED', candidateCount: 148, finishedAt: '2026-11-14T10:00:42Z' })])}
        rules={[]}
        preview={null}
      />,
    );
    expect(html).toContain('Running — waiting for the provider');
    expect(html).toContain('Extraction in progress — this page updates by itself.');
    expect(html).toContain('<th>Elapsed</th>');
    expect(html).toContain('>148<');
    expect(html).toContain('42s');
    expect(html).not.toMatch(/Refresh in a minute/);
    expect(a11yProblems(html)).toEqual([]);
  });
});
