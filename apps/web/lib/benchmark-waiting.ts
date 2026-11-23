/** GET /run-reviews/waiting: an RL Gym review batch with episodes no one has decided yet. */
export interface WaitingBatch {
  projectId: string;
  projectName: string;
  ref: string;
  batchId: string;
  runId: string | null;
  items: number;
  waiting: number;
  receivedAt: string;
  href: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Console Home: one tile per waiting batch, linking to that project's Benchmark tab. */
export function benchmarkReviewTile(b: WaitingBatch) {
  const run = b.runId ? ` from run ${b.runId}` : '';
  return {
    label: `Benchmark review: ${b.projectName}`,
    count: b.waiting,
    hint: `${plural(b.waiting, 'episode', 'episodes')} of ${b.items}${run} waiting for a decision (batch ${b.batchId}, received ${b.receivedAt.slice(0, 10)}).`,
    href: b.href,
  };
}

/** Benchmark tab count: episodes still to decide in this project, or nothing when none are waiting. */
export function benchmarkTabCount(batches: WaitingBatch[], projectId: string): string | undefined {
  const n = batches.filter((b) => b.projectId === projectId).reduce((s, b) => s + b.waiting, 0);
  return n ? `${n} to review` : undefined;
}
