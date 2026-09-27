import type { CoverageTags } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { toVectorLiteral } from './embeddings';

export interface SimilarMatch {
  taskId: string;
  embeddingScore: number;
  structuredScore: number;
  flagged: boolean;
}

const tokens = (c: CoverageTags | null, keyInputs: string[]) =>
  new Set([...Object.entries(c?.tags ?? {}).map(([k, v]) => `${k}=${v.toLowerCase()}`), ...(c?.edgeCase ? [`edge=${c.edgeCase.toLowerCase()}`] : []), ...keyInputs.map((k) => `in=${k.toLowerCase()}`)]);
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size && !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};

/**
 * Near-duplicate search (SPEC): the task is compared with accepted and pending tasks of the same workflow across
 * projects (same template lineage) by embedding cosine, plus a structured comparison of coverage tags and key
 * inputs. A match at or above the template's threshold on either method is flagged for the Reviewer.
 */
export async function findSimilar(
  tx: Db | Tx,
  args: { taskId: string; lineageId: string; embedding: number[]; coverage: CoverageTags | null; keyInputs: string[]; threshold: number; limit?: number },
): Promise<SimilarMatch[]> {
  const vec = toVectorLiteral(args.embedding);
  const rows = await tx.$queryRaw<{ id: string; score: number; coverage_tags: CoverageTags | null; key_inputs: string[] | null }[]>`
    SELECT t.id, 1 - (t.embedding <=> ${vec}::vector) AS score, t.coverage_tags,
           (SELECT array_agg(value) FROM jsonb_array_elements_text(COALESCE(t.checks -> 'keyInputs', '[]'::jsonb))) AS key_inputs
    FROM "TaskInstance" t
    JOIN "Project" p ON p.id = t.project_id
    JOIN "Template" tp ON tp.id = p.template_id
    WHERE tp.lineage_id = ${args.lineageId}::uuid AND t.id <> ${args.taskId}::uuid
      AND t.status IN ('SUBMITTED', 'ACCEPTED') AND t.embedding IS NOT NULL AND t.quarantined_at IS NULL
    ORDER BY t.embedding <=> ${vec}::vector
    LIMIT ${args.limit ?? 5}`;
  const mine = tokens(args.coverage, args.keyInputs);
  return rows.map((r) => {
    const structuredScore = jaccard(mine, tokens(r.coverage_tags, r.key_inputs ?? []));
    const embeddingScore = Math.max(0, Math.min(1, Number(r.score)));
    return { taskId: r.id, embeddingScore, structuredScore, flagged: embeddingScore >= args.threshold || (args.keyInputs.length > 0 && structuredScore >= args.threshold) };
  });
}

export async function storeEmbedding(tx: Tx, taskId: string, embedding: number[]) {
  await tx.$executeRaw`UPDATE "TaskInstance" SET embedding = ${toVectorLiteral(embedding)}::vector WHERE id = ${taskId}::uuid`;
}
