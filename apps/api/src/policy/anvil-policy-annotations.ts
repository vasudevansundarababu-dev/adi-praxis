import {
  ANNOTATIONS_NOTICE, APPLICABILITY_OUTCOMES, PROJECT_POLICY_ANNOTATIONS_SCHEMA_VERSION, REVERSE_RELATION, RuleAnnotation, annotationText, validateProjectPolicyAnnotations,
  type AnnotationEntry, type AnnotationProblem, type ProjectPolicyAnnotations,
} from '@praxis/shared';
import type { ObjectStorage } from '../candidate/storage';
import type { Db } from '../db';
import { sha256, stableStringify } from '../lib/crypto';
import { revisionsForRules, type RevisionRow } from './annotations';
import { buildProjectPolicyManifest, ruleIdOf, sourceLocation, type BuiltProjectPolicy, type ManifestRuleSource, type ProjectPolicyProblem } from './anvil-project-policy';

/**
 * Builds `praxis.anvil.project_policy_annotations.v1` (PROPOSED; docs/anvil/RL-GYM-POLICY-ANNOTATIONS-CHANGE-NOTE.md):
 * one entry per rule of the v1 manifest, from the published rule sets the manifest uses. The v1 manifest is built by
 * the same, unchanged code and its sha256 binds the two. Annotations come from the frozen rule versions; provenance
 * from the append-only revision table and the immutable reviewed versions, so the same published state always gives
 * the same bytes. Read-only.
 */

const snap = (a: RuleAnnotation) => ({ annotation_version: a.version, classification: a.classification, marking: a.marking, applies_when: a.appliesWhen, why: a.why });

/** The AI suggestion behind the current annotation: itself if unedited, else the newest AI revision before the edit. */
function provenance(revisions: RevisionRow[], a: RuleAnnotation | undefined) {
  const current = a ? (revisions.find((r) => r.annotationVersion === a.version) ?? null) : null;
  const ai = current?.source === 'AI_SUGGESTION' ? current : current ? ([...revisions].reverse().find((r) => r.source === 'AI_SUGGESTION' && r.createdAt <= current.createdAt) ?? null) : null;
  return { current, ai };
}

export interface BuiltAnnotations {
  manifest: BuiltProjectPolicy;
  doc: ProjectPolicyAnnotations | null;
  bytes: Buffer | null;
  sha256: string | null;
  problems: Array<ProjectPolicyProblem | AnnotationProblem>;
}

export async function buildProjectPolicyAnnotations(db: Db, storage: ObjectStorage, project: { id: string; clientId: string; name: string }): Promise<BuiltAnnotations> {
  const manifest = await buildProjectPolicyManifest(db, storage, project);
  if (manifest.problems.length) return { manifest, doc: null, bytes: null, sha256: null, problems: manifest.problems };

  const p = await db.project.findUniqueOrThrow({ where: { id: project.id }, select: { templateId: true, templateVersion: true } });
  const sources = [...manifest.index.values()];
  const ruleIds = [...new Set(sources.map((s) => s.rule.ruleId))];
  const revisions = await revisionsForRules(db, project.clientId, ruleIds);
  const byRule = new Map<string, RevisionRow[]>();
  for (const r of revisions) byRule.set(r.ruleId, [...(byRule.get(r.ruleId) ?? []), r]);
  const versions = new Map((await db.policyRuleVersion.findMany({ where: { id: { in: sources.map((s) => s.rule.ruleVersionId) } }, select: { id: true, reviewedById: true, reviewedAt: true } })).map((v) => [v.id, v]));
  const reviewer = (id: string | null) => ({ id: id ?? 'unknown', role: null });
  const roles = new Map((await db.user.findMany({ where: { id: { in: [...new Set([...versions.values()].map((v) => v.reviewedById).filter((x): x is string => !!x))] } }, select: { id: true, roles: true } })).map((u) => [u.id, u.roles.includes('ADMIN') ? 'ADMIN' : u.roles.includes('PM') ? 'PM' : null]));

  const link = (s: ManifestRuleSource, relation: string, ruleKey: string) => {
    const t = s.setRules.get(ruleKey);
    return { relation, rule_key: ruleKey, rule_id: t ? ruleIdOf(t) : null, rule_version_id: t?.ruleVersionId ?? null, rule_version: t?.version ?? null, status: t ? ('in_set' as const) : ('not_in_set' as const) };
  };

  const entries: AnnotationEntry[] = [];
  for (const pol of manifest.manifest.policies) {
    for (const mr of pol.rules) {
      const s = manifest.index.get(`${pol.policy_id}@${pol.version}#${mr.rule_id}`)!;
      const b = s.rule.body;
      const a = b.annotation;
      const { current, ai } = provenance(byRule.get(s.rule.ruleId) ?? [], a);
      const v = versions.get(s.rule.ruleVersionId);
      const loc = (s.source.locator ?? {}) as { page?: number | null; section?: string | null; lineStart?: number | null; lineEnd?: number | null };
      const links = (a?.links ?? []).map((l) => link(s, l.relation, l.ruleKey));
      const linkedFrom = [...s.setRules.values()].flatMap((o) => (o.body.annotation?.links ?? []).filter((l) => l.ruleKey === s.rule.ruleKey).map((l) => link(s, REVERSE_RELATION[l.relation], o.ruleKey)));
      const members = a?.compound ? [...s.setRules.values()].filter((o) => o.body.annotation?.compound?.groupKey === a.compound!.groupKey).map((o) => o.ruleKey).sort() : [];
      entries.push({
        policy_id: pol.policy_id,
        policy_version: pol.version,
        rule_id: mr.rule_id,
        annotation_status: a ? 'annotated' : 'not_annotated',
        identity: { praxis_rule_id: s.rule.ruleId, rule_key: s.rule.ruleKey, rule_version_id: s.rule.ruleVersionId, rule_version: s.rule.version, content_hash: s.rule.contentHash, project_rule_set: { id: s.set.id, version: s.set.version, digest: s.set.digest } },
        source: {
          document_id: s.docVersion.documentId,
          document_version_id: s.docVersion.id,
          document_version: s.docVersion.version,
          sha256: s.docVersion.sha256,
          quotation: s.source.quote,
          quotation_verified: !('resolution' in s.source) || (s.source as { resolution?: string }).resolution === 'RESOLVED',
          locator: { page: loc.page ?? null, section: loc.section ?? null, line_start: loc.lineStart ?? null, line_end: loc.lineEnd ?? null },
          source_location: sourceLocation(s.docVersion, s.source.locator),
        },
        meaning: { requirement: b.requirement, classification: a?.classification ?? null },
        mandatory: { marking: a?.marking ?? null, explanation: a?.why ?? null },
        applicability: {
          responsible_actor: a?.responsibleActor ?? 'unknown',
          actor_note: a?.actorNote ?? null,
          actors_as_extracted: b.applicability.actors,
          application_types: a?.applicationTypes ?? { kind: 'unknown', items: [] },
          jurisdictions: a?.jurisdictions ?? { kind: 'unknown', items: [] },
          applies_when: a?.appliesWhen ?? null,
          prerequisites: b.prerequisites,
          workflow_stage: a?.workflowStage ?? null,
          effective: { from: b.effective.from, to: b.effective.to, condition: b.effective.conditionText },
        },
        exceptions_timing: { exceptions: b.exceptions, deadline: { kind: a?.deadline.kind ?? 'unknown', text: a?.deadline.text ?? null, measured_from: a?.deadline.measuredFrom ?? null } },
        relationships: {
          links,
          linked_from: linkedFrom,
          compound: a?.compound ? { group_key: a.compound.groupKey, original_statement: a.compound.originalStatement, role: a.compound.role, members } : null,
          precedence: b.precedence.map((x) => ({ rule_key: x.ruleKey, relation: x.relation, note: x.note })),
        },
        evidence: { known: b.evidenceNeeds, status: a?.evidence.status ?? 'unknown', missing: a?.evidence.missing ?? [] },
        uncertainty: {
          open_questions: a?.openQuestions ?? [],
          notes: b.uncertainty,
          unresolved_dependencies: [...links, ...linkedFrom].filter((l) => l.status === 'not_in_set').map((l) => `${l.relation} ${l.rule_key}: not in the published rule set`),
          duplicates_or_overlaps: links.filter((l) => l.relation === 'duplicate_of' || l.relation === 'overlaps').map((l) => `${l.relation} ${l.rule_key}`),
        },
        provenance: {
          ai_suggestion: ai ? { annotation: snap(RuleAnnotation.parse(ai.annotation)), model: ai.model, prompt_version: ai.promptVersion, created_at: ai.createdAt.toISOString() } : null,
          current: a && current ? { annotation: snap(a), source: current.source === 'AI_SUGGESTION' ? 'ai_suggestion_unedited' : 'author_edit', edited_by: { id: current.editedById, role: current.editedRole }, edited_at: current.createdAt.toISOString() } : null,
          approval: { status: 'applied', decided_by: { ...reviewer(v?.reviewedById ?? null), role: (v?.reviewedById && roles.get(v.reviewedById)) || null }, decided_at: (v?.reviewedAt ?? s.set.createdAt).toISOString(), decided_by_human: true },
        },
        readable_text: `${b.requirement} ${annotationText(a)}`.slice(0, 20000),
      });
    }
  }
  const doc: ProjectPolicyAnnotations = {
    schema_version: PROJECT_POLICY_ANNOTATIONS_SCHEMA_VERSION,
    contract_status: 'proposed',
    source_project: { id: project.id, version: manifest.manifest.source_project.version },
    template: { id: p.templateId, version: p.templateVersion },
    manifest_sha256: manifest.sha256,
    interpretation: { outcomes: [...APPLICABILITY_OUTCOMES], notice: ANNOTATIONS_NOTICE },
    rules: entries,
  };
  const problems = validateProjectPolicyAnnotations(doc, manifest.manifest, manifest.sha256);
  const bytes = Buffer.from(stableStringify(doc), 'utf8');
  return { manifest, doc, bytes, sha256: sha256(bytes.toString('utf8')), problems };
}
