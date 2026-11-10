/**
 * Policy sidecar v2 (contracts/praxis/policy-snapshot.v2.schema.json, docs/integrations/POLICY-SNAPSHOT-V2.md).
 * A pure projection of a stored v1 snapshot: content identity (hashes of what the rules say and which document bytes
 * they cite) is separated from database identity (IDs, versions, timestamps), which moves to `provenance`.
 * Hashes never include provenance, so unchanged content keeps its hash across reseeds.
 */
import { sha256, stableStringify } from '../lib/crypto';

export const POLICY_SIDECAR_V2 = 'praxis.anvil.policy.v2-proposed';
export const CONTENT_HASH_ALGORITHM = 'praxis.content-hash.v1';

/** SHA-256 (lowercase hex) of the RFC 8785 canonical JSON of `value`, encoded as UTF-8. */
export const contentHashV2 = (value: unknown) => sha256(stableStringify(value));

interface V1Source { document_version_id: string; sha256: string; field: string; role: string; quote: string; locator: unknown }
interface V1Rule {
  rule_id: string; rule_key: string; rule_version_id: string; version: number; content_hash: string;
  title: string; requirement: string; requirement_type: string; visibility: string; applicability: unknown; applicability_label: string;
  prerequisites: unknown; precedence: unknown; exceptions: unknown; effective: unknown; evidence_needs: unknown; verification_hint: string | null;
  sources: V1Source[];
}
interface V1Change { id: string; rule_version_id: string; type: string; requirement: string; scope: unknown; reason: string; source_citation_id: string | null; exception_index: number | null }
interface V1Content { project_rule_set: { id: string; version: number; digest: string }; rules: V1Rule[]; task_changes: V1Change[]; rubric_version: string }

const bySourceKey = (a: { document_sha256: string; field: string; role: string; quote: string }, b: typeof a) =>
  stableStringify([a.document_sha256, a.field, a.role, a.quote]) < stableStringify([b.document_sha256, b.field, b.role, b.quote]) ? -1 : 1;

/** The fields that define a rule's content. Order of keys is irrelevant (canonical JSON sorts them). */
export function ruleHashInput(r: V1Rule) {
  return {
    rule_key: r.rule_key,
    title: r.title,
    requirement: r.requirement,
    requirement_type: r.requirement_type,
    visibility: r.visibility,
    applicability: r.applicability,
    prerequisites: r.prerequisites,
    precedence: r.precedence,
    exceptions: r.exceptions,
    effective: r.effective,
    evidence_needs: r.evidence_needs,
    verification_hint: r.verification_hint,
    sources: r.sources.map((s) => ({ document_sha256: s.sha256, field: s.field, role: s.role, quote: s.quote })).sort(bySourceKey),
  };
}

export function sidecarV2(
  s: { id: string; taskInstanceId: string; version: number; content: unknown; digest: string; createdAt: Date },
  opts: { taskRef?: string | null; agentVisibleOnly?: boolean } = {},
) {
  const c = s.content as V1Content;
  const all = c.rules.map((r) => {
    const content_hash = contentHashV2(ruleHashInput(r));
    return {
      v1: r,
      out: {
        rule_key: r.rule_key,
        content_hash,
        title: r.title,
        requirement: r.requirement,
        requirement_type: r.requirement_type,
        visibility: r.visibility,
        applicability: r.applicability,
        applicability_label: r.applicability_label,
        prerequisites: r.prerequisites,
        precedence: r.precedence,
        exceptions: r.exceptions,
        effective: r.effective,
        evidence_needs: r.evidence_needs,
        verification_hint: r.verification_hint,
        sources: r.sources.map((x) => ({ document_sha256: x.sha256, field: x.field, role: x.role, quote: x.quote, locator: x.locator, provenance: { document_version_id: x.document_version_id } })),
        provenance: { rule_id: r.rule_id, rule_version_id: r.rule_version_id, rule_version: r.version, praxis_content_hash: r.content_hash },
      },
    };
  });
  const byVersionId = new Map(all.map((r) => [r.v1.rule_version_id, r.out]));
  const rules = (opts.agentVisibleOnly ? all.filter((r) => r.v1.visibility === 'agent_visible') : all).map((r) => r.out);
  const visible = new Set(rules.map((r) => r.provenance.rule_version_id));
  const changes = c.task_changes.filter((x) => !opts.agentVisibleOnly || visible.has(x.rule_version_id)).map((x) => {
    const rule = byVersionId.get(x.rule_version_id);
    if (!rule) throw new Error(`Task change ${x.id} names a rule version outside its snapshot`);
    const content = { rule_key: rule.rule_key, rule_content_hash: rule.content_hash, type: x.type, requirement: x.requirement, scope: x.scope, reason: x.reason, exception_index: x.exception_index };
    return { ...content, content_hash: contentHashV2(content), provenance: { change_id: x.id, rule_version_id: x.rule_version_id, source_citation_id: x.source_citation_id } };
  });
  return {
    schema_version: POLICY_SIDECAR_V2,
    hash_algorithm: CONTENT_HASH_ALGORITHM,
    task_ref: opts.taskRef ?? null,
    content_hash: contentHashV2({ rules: rules.map((r) => r.content_hash).sort(), task_changes: changes.map((x) => x.content_hash).sort() }),
    rules,
    task_changes: changes,
    provenance: {
      snapshot_id: s.id,
      task_instance_id: s.taskInstanceId,
      snapshot_version: s.version,
      published_at: s.createdAt.toISOString(),
      project_rule_set: c.project_rule_set,
      rubric_version: c.rubric_version,
      praxis_digest: s.digest,
    },
  };
}
