import { describe, expect, it } from 'vitest';
import { pairwiseClusterF1, scoreQueryClustering } from '../src/cluster-f1';

describe('Q4 clustering F1 (owner, 12 Nov 2026)', () => {
  it('ignores label names: the same grouping under other names scores 1', () => {
    expect(pairwiseClusterF1(['CL1', 'CL1', 'CL2', 'CL2'], ['brand', 'brand', 'generic', 'generic'])).toMatchObject({ f1: 1, precision: 1, recall: 1, passed: true });
  });
  it('a merged cluster loses precision; a split cluster loses recall', () => {
    const merged = pairwiseClusterF1(['A', 'A', 'B', 'B'], ['X', 'X', 'X', 'X']);
    expect(merged).toMatchObject({ precision: 0.3333, recall: 1, passed: false });
    const split = pairwiseClusterF1(['A', 'A', 'A', 'A'], ['X', 'X', 'Y', 'Y']);
    expect(split).toMatchObject({ precision: 1, recall: 0.3333, passed: false });
  });
  it('unclustered queries form no pairs; both empty agree', () => {
    expect(pairwiseClusterF1([null, null], [null, null]).f1).toBe(1);
    expect(pairwiseClusterF1(['A', 'A'], [null, null]).f1).toBe(0);
  });
  it('scores q01_cluster… fields of an agent output against the reference; null for other tasks', () => {
    const ref = { q01_cluster: 'CL1', q02_cluster: 'CL1', q03_cluster: 'none', q01_intent: 'commercial' };
    expect(scoreQueryClustering(ref, { q01_cluster: 'shoes', q02_cluster: 'shoes', q03_cluster: 'none' })).toMatchObject({ queries: 3, f1: 1, threshold: 0.99, passed: true });
    expect(scoreQueryClustering(ref, { q01_cluster: 'a', q02_cluster: 'b' })).toMatchObject({ f1: 0, passed: false });
    expect(scoreQueryClustering({ recommendation: 'escalate' }, {})).toBeNull();
  });
});
