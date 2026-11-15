import { z } from 'zod';
import { APPLICABILITY_OUTCOMES, COMPOUND_ROLES, MANDATORY_MARKINGS, RESPONSIBLE_ACTORS, RULE_CLASSIFICATIONS } from './policy-annotations';

/**
 * `praxis.anvil.project_policy_annotations.v1` — PROPOSED (docs/anvil/RL-GYM-POLICY-ANNOTATIONS-CHANGE-NOTE.md). An
 * additive, evaluator-side companion to the unchanged `praxis.anvil.project_policy.v1` manifest: one entry per
 * (policy, version, rule) in that manifest, bound to it by `manifest_sha256`. Built only from published rule sets, so
 * it carries exactly the approved rule and annotation versions. It quotes source text and must never be shown to
 * agents. Nullable means unknown; it never means "does not apply".
 */
export const PROJECT_POLICY_ANNOTATIONS_SCHEMA_VERSION = 'praxis.anvil.project_policy_annotations.v1' as const;

const id = z.string().min(1).max(200);
const txt = z.string().max(20000);
const list = z.array(z.string().max(2000)).max(100);
const scope = z.object({ kind: z.enum(['all', 'listed', 'unknown']), items: list }).strict();
const person = z.object({ id: z.string().max(100), role: z.string().max(40).nullable() }).strict();

const LinkOut = z
  .object({
    relation: z.string().max(40),
    rule_key: id,
    /** The linked rule's manifest rule_id and exact version in the same published set; null when it is not in the set. */
    rule_id: id.nullable(),
    rule_version_id: id.nullable(),
    rule_version: z.number().int().nullable(),
    status: z.enum(['in_set', 'not_in_set']),
  })
  .strict();

export const AnnotationSnapshot = z
  .object({
    annotation_version: z.number().int().min(1),
    classification: z.enum(RULE_CLASSIFICATIONS),
    marking: z.enum(MANDATORY_MARKINGS),
    applies_when: txt.nullable(),
    why: txt.nullable(),
  })
  .strict();

export const AnnotationEntry = z
  .object({
    policy_id: id,
    policy_version: id,
    rule_id: id,
    annotation_status: z.enum(['annotated', 'not_annotated']),
    identity: z
      .object({
        praxis_rule_id: id,
        rule_key: id,
        rule_version_id: id,
        rule_version: z.number().int().min(1),
        content_hash: z.string().regex(/^[a-f0-9]{64}$/),
        project_rule_set: z.object({ id, version: z.number().int().min(1), digest: z.string() }).strict(),
      })
      .strict(),
    source: z
      .object({
        document_id: id,
        document_version_id: id,
        document_version: z.number().int().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        quotation: txt,
        quotation_verified: z.boolean(),
        locator: z.object({ page: z.number().int().nullable(), section: z.string().nullable(), line_start: z.number().int().nullable(), line_end: z.number().int().nullable() }).strict(),
        source_location: txt,
      })
      .strict(),
    meaning: z.object({ requirement: txt, classification: z.enum(RULE_CLASSIFICATIONS).nullable() }).strict(),
    mandatory: z.object({ marking: z.enum(MANDATORY_MARKINGS).nullable(), explanation: txt.nullable() }).strict(),
    applicability: z
      .object({
        responsible_actor: z.enum(RESPONSIBLE_ACTORS),
        actor_note: txt.nullable(),
        actors_as_extracted: list,
        application_types: scope,
        jurisdictions: scope,
        applies_when: txt.nullable(),
        prerequisites: list,
        workflow_stage: txt.nullable(),
        effective: z.object({ from: z.string().nullable(), to: z.string().nullable(), condition: txt.nullable() }).strict(),
      })
      .strict(),
    exceptions_timing: z
      .object({
        exceptions: z.object({ kind: z.enum(['none', 'unknown', 'listed']), items: z.array(z.object({ statement: txt, conditions: txt.nullable() }).strict()).max(20) }).strict(),
        deadline: z.object({ kind: z.enum(['none', 'unknown', 'stated']), text: txt.nullable(), measured_from: txt.nullable() }).strict(),
      })
      .strict(),
    relationships: z
      .object({
        links: z.array(LinkOut).max(100),
        linked_from: z.array(LinkOut).max(500),
        compound: z.object({ group_key: id, original_statement: txt, role: z.enum(COMPOUND_ROLES), members: z.array(id).max(50) }).strict().nullable(),
        precedence: z.array(z.object({ rule_key: id, relation: z.string().max(40), note: txt.nullable() }).strict()).max(20),
      })
      .strict(),
    evidence: z.object({ known: list, status: z.enum(['stated', 'partly_stated', 'unknown']), missing: list }).strict(),
    uncertainty: z.object({ open_questions: list, notes: list, unresolved_dependencies: list, duplicates_or_overlaps: list }).strict(),
    provenance: z
      .object({
        ai_suggestion: z.object({ annotation: AnnotationSnapshot, model: z.string().nullable(), prompt_version: z.string().nullable(), created_at: z.string() }).strict().nullable(),
        current: z.object({ annotation: AnnotationSnapshot, source: z.enum(['ai_suggestion_unedited', 'author_edit']), edited_by: person, edited_at: z.string() }).strict().nullable(),
        approval: z.object({ status: z.literal('applied'), decided_by: person, decided_at: z.string(), decided_by_human: z.literal(true) }).strict(),
      })
      .strict(),
    readable_text: txt,
  })
  .strict();
export type AnnotationEntry = z.infer<typeof AnnotationEntry>;

export const ProjectPolicyAnnotations = z
  .object({
    schema_version: z.literal(PROJECT_POLICY_ANNOTATIONS_SCHEMA_VERSION),
    contract_status: z.literal('proposed'),
    source_project: z.object({ id, version: id }).strict(),
    template: z.object({ id, version: z.number().int() }).strict().nullable(),
    manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    interpretation: z.object({ outcomes: z.array(z.enum(APPLICABILITY_OUTCOMES)), notice: txt }).strict(),
    rules: z.array(AnnotationEntry).max(10000),
  })
  .strict();
export type ProjectPolicyAnnotations = z.infer<typeof ProjectPolicyAnnotations>;

export const ANNOTATIONS_NOTICE =
  'Annotations support binding policy rules to evaluators. They do not show that an evaluator is installed, calibrated or qualified. ' +
  'AI suggestions are not decisions: provenance.approval is the human PM/Admin decision to apply the rule version. ' +
  'A rule whose applicability or evidence is unknown, or that has unresolved dependencies, must not be scored as a pass or as "not applicable". ' +
  'This document quotes source text and is evaluator-side only: never show it to agents.';

export interface AnnotationProblem {
  code: 'SCHEMA' | 'MANIFEST_MISMATCH' | 'MISSING_RULE' | 'EXTRA_RULE' | 'DUPLICATE_RULE';
  path: string;
  message: string;
}

/** Schema plus the binding to the manifest: exactly one entry per manifest rule, and the manifest digest. */
export function validateProjectPolicyAnnotations(doc: unknown, manifest: { source_project: { id: string; version: string }; policies: Array<{ policy_id: string; version: string; rules: Array<{ rule_id: string }> }> }, manifestSha256: string): AnnotationProblem[] {
  const r = ProjectPolicyAnnotations.safeParse(doc);
  if (!r.success) return r.error.issues.slice(0, 20).map((i) => ({ code: 'SCHEMA', path: i.path.join('/'), message: i.message }));
  const d = r.data;
  const out: AnnotationProblem[] = [];
  if (d.manifest_sha256 !== manifestSha256) out.push({ code: 'MANIFEST_MISMATCH', path: 'manifest_sha256', message: 'The annotations are not bound to this manifest.' });
  if (d.source_project.id !== manifest.source_project.id || d.source_project.version !== manifest.source_project.version) out.push({ code: 'MANIFEST_MISMATCH', path: 'source_project', message: 'The project or its version differs from the manifest.' });
  const want = new Set(manifest.policies.flatMap((p) => p.rules.map((x) => `${p.policy_id}@${p.version}#${x.rule_id}`)));
  const seen = new Set<string>();
  for (const [i, e] of d.rules.entries()) {
    const k = `${e.policy_id}@${e.policy_version}#${e.rule_id}`;
    if (seen.has(k)) out.push({ code: 'DUPLICATE_RULE', path: `rules/${i}`, message: `${k} appears twice.` });
    if (!want.has(k)) out.push({ code: 'EXTRA_RULE', path: `rules/${i}`, message: `${k} is not in the manifest.` });
    seen.add(k);
  }
  for (const k of want) if (!seen.has(k)) out.push({ code: 'MISSING_RULE', path: 'rules', message: `${k} has no annotation entry.` });
  return out;
}
