import { describe, expect, it } from 'vitest';
import { computeProjectFigures, coverageStatus, generateSlots, pickSlot, slotSignature } from '../src';

const KYC_DIMENSIONS = [
  { key: 'customer_type', label: 'Customer type', values: ['individual', 'sole trader', 'corporate', 'trust'] },
  { key: 'jurisdiction', label: 'Jurisdiction', values: [] },
  { key: 'risk_level', label: 'Risk level', values: ['low', 'medium', 'high'] },
  { key: 'channel', label: 'Channel', values: ['in-branch', 'remote'] },
];
const EDGES = ['Expired or damaged ID', 'Name mismatch across documents', 'PEP link', 'Sanctions near-match', 'Missing proof of address', 'Complex or circular ownership', 'Nominee director', 'Conflicting registry data', 'High-risk jurisdiction', 'Adverse media hit'].map(
  (name) => ({ name, description: '', quota: 1, required: true }),
);

describe('coverage slots', () => {
  it('a 50-task KYC project generates 50 slots: required edge cases, 20% open, the rest spread across combinations', () => {
    const slots = generateSlots({ dimensions: KYC_DIMENSIONS, cells: [], edgeCases: EDGES, distinctTarget: 50, openSlotShare: 0.2 });
    expect(slots).toHaveLength(50);
    expect(slots.filter((s) => s.required && s.edgeCase)).toHaveLength(10);
    expect(slots.filter((s) => s.isOpen)).toHaveLength(10);
    const combos = slots.filter((s) => !s.isOpen && !s.edgeCase);
    expect(combos).toHaveLength(30);
    // 24 distinct combinations (4 × 3 × 2) before any repeats.
    expect(new Set(combos.slice(0, 24).map((s) => slotSignature(s))).size).toBe(24);
    expect(combos[0]!.brief).toBe('Customer type: individual · Risk level: low · Channel: in-branch');
    // At cap 4 the project needs 13 authors.
    expect(computeProjectFigures({ taskMode: 'AUTHORING', distinctTarget: 50, maxPerExpert: 4, taskCount: null, tptMinutes: 60, hoursPerWorkerDay: 4, startDate: '2026-10-05', endDate: '2026-11-06', wagePerTask: 40 }).requiredAuthors).toBe(13);
  });

  it('required cells come first and open slots never displace required coverage', () => {
    const slots = generateSlots({
      dimensions: KYC_DIMENSIONS,
      cells: [{ tags: { customer_type: 'corporate', risk_level: 'high' }, quota: 3, required: true }, { tags: { customer_type: 'trust' }, quota: 1, required: false }],
      edgeCases: EDGES.slice(0, 2),
      distinctTarget: 6,
      openSlotShare: 0.5,
    });
    expect(slots.map((s) => (s.isOpen ? 'open' : s.edgeCase ?? JSON.stringify(s.tags)))).toEqual([
      '{"customer_type":"corporate","risk_level":"high"}',
      '{"customer_type":"corporate","risk_level":"high"}',
      '{"customer_type":"corporate","risk_level":"high"}',
      'Expired or damaged ID',
      'Name mismatch across documents',
      'open',
    ]);
  });

  it('pickSlot never gives an expert two identical slots, prefers new cells and respects scope jurisdictions', () => {
    const s = (id: string, tags: Record<string, string>, extra: Partial<{ edgeCase: string; isOpen: boolean; required: boolean }> = {}) => ({ id, tags, edgeCase: extra.edgeCase ?? null, isOpen: extra.isOpen ?? false, required: extra.required ?? false });
    const available = [s('a', { customer_type: 'corporate', risk_level: 'high' }), s('b', { customer_type: 'corporate', risk_level: 'low' }), s('c', { customer_type: 'trust', risk_level: 'low' }), s('d', { jurisdiction: 'FR' }, { required: true })];
    const held = [{ tags: { customer_type: 'corporate', risk_level: 'high' }, edgeCase: null, isOpen: false }];
    expect(pickSlot(available, held, { jurisdictions: ['GB'] })!.id).toBe('c');
    expect(pickSlot(available, held, { jurisdictions: ['FR'] })!.id).toBe('d');
    expect(pickSlot([available[0]!], held, { jurisdictions: [] })).toBeNull();
  });

  it('coverage is met only when every required cell and edge case reaches its quota', () => {
    const req = { cells: [{ tags: { customer_type: 'corporate' }, quota: 2, required: true }], edgeCases: [{ name: 'PEP link', quota: 1, required: true }, { name: 'Nominee director', quota: 1, required: false }] };
    const corp = { tags: { customer_type: 'corporate', risk_level: 'high' }, edgeCase: null };
    const pep = { tags: { customer_type: 'individual' }, edgeCase: 'PEP link' };
    expect(coverageStatus(req, [corp, pep]).met).toBe(false);
    const done = coverageStatus(req, [corp, corp, pep], [{ tags: {}, edgeCase: 'Nominee director' }]);
    expect(done.met).toBe(true);
    expect(done.edgeCases.map((e) => e.state)).toEqual(['FILLED', 'IN_PROGRESS']);
  });
});
