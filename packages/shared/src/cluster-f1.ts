/**
 * Clustering quality for Q4 paid search query clustering (owner, 12 Nov 2026): Praxis scores an agent's clusters
 * against the author's reference by pairwise F1. Cluster labels are arbitrary (the agent names its own clusters), so
 * only "are these two queries in the same cluster?" is compared. Queries not clustered ("none" or missing) belong to no
 * pair. The catalogue requires F1 >= 0.99. The score is advice for the human Reviewer, never a decision.
 */
export const CLUSTER_F1_THRESHOLD = 0.99;

const NONE = new Set(['', 'none', 'null']);
const label = (v: unknown) => (typeof v === 'string' && !NONE.has(v.trim().toLowerCase()) ? v.trim() : null);

/** Unordered pairs (i < j) whose items share a label. */
function samePairs(labels: Array<string | null>): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (labels[i] !== null && labels[i] === labels[j]) out.add(`${i}:${j}`);
  return out;
}

export interface ClusterScore {
  queries: number;
  precision: number;
  recall: number;
  f1: number;
  threshold: number;
  passed: boolean;
}

/** Pairwise precision, recall and F1 between two labelings of the same items (by position). */
export function pairwiseClusterF1(reference: Array<string | null>, predicted: Array<string | null>): ClusterScore {
  const ref = samePairs(reference);
  const pred = samePairs(predicted.slice(0, reference.length));
  let both = 0;
  for (const p of pred) if (ref.has(p)) both++;
  // No pairs on either side: the clusterings agree that nothing belongs together.
  const precision = pred.size ? both / pred.size : ref.size ? 0 : 1;
  const recall = ref.size ? both / ref.size : pred.size ? 0 : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const round = (x: number) => Math.round(x * 10000) / 10000;
  return { queries: reference.length, precision: round(precision), recall: round(recall), f1: round(f1), threshold: CLUSTER_F1_THRESHOLD, passed: f1 >= CLUSTER_F1_THRESHOLD };
}

/** The per-query cluster fields (q01_cluster, q02_cluster, …) of an output.json, in query order. */
export function clusterFields(output: Record<string, unknown>, prefix = 'q'): string[] {
  return Object.keys(output)
    .filter((k) => new RegExp(`^${prefix}\\d{2}_cluster$`).test(k))
    .sort();
}

/**
 * Scores an agent's output.json against the reference output of the exported task. Returns null when the reference has
 * no per-query cluster fields (not a Q4 task).
 */
export function scoreQueryClustering(referenceOutput: Record<string, unknown>, agentOutput: Record<string, unknown>): ClusterScore | null {
  const keys = clusterFields(referenceOutput);
  if (!keys.length) return null;
  return pairwiseClusterF1(
    keys.map((k) => label(referenceOutput[k])),
    keys.map((k) => label(agentOutput[k])),
  );
}
