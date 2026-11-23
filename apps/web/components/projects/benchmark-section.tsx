import { apiGet } from '@/lib/api';
import { BenchmarkReviewPanel, RlGymExportPanel, SmeNeedsPanel, type NeedRow, type ReviewBatch, type RlGymExportState } from './rlgym-panel';

/** Project → Benchmark: RL Gym export, SME needs and Benchmark review, each loaded from its own route. */
export async function BenchmarkSection({ projectId }: { projectId: string }) {
  const [exp, needs, reviews] = await Promise.all([
    apiGet<RlGymExportState>(`/projects/${projectId}/rlgym-export`),
    apiGet<{ items: NeedRow[]; studioConnected: boolean }>(`/projects/${projectId}/needs`),
    apiGet<{ items: ReviewBatch[]; connected: boolean; canDecide?: boolean }>(`/projects/${projectId}/run-reviews`),
  ]);
  return (
    <div className="space-y-6" aria-label="Benchmark">
      {exp.data && <RlGymExportPanel projectId={projectId} initial={exp.data} />}
      {needs.data && <SmeNeedsPanel projectId={projectId} needs={needs.data.items} studioConnected={needs.data.studioConnected} />}
      {reviews.data && <BenchmarkReviewPanel projectId={projectId} batches={reviews.data.items} connected={reviews.data.connected} canDecide={reviews.data.canDecide ?? true} />}
    </div>
  );
}
