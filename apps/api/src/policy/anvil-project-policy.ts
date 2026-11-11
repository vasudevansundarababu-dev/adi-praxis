import type { ApprovedTaskRecord, PolicyDocument, PolicyDocumentVersion, ProjectRuleSet } from '@prisma/client';
import {
  POLICY_MEDIA_TYPES, PROJECT_POLICY_ID_PATTERN, PROJECT_POLICY_SCHEMA_VERSION, type PolicyFormat, ProjectRuleSetContent, validateProjectPolicyManifest, type AnvilPolicyRef, type ManifestProblem, type ProjectPolicyManifest,
} from '@praxis/shared';
import type { ObjectStorage } from '../candidate/storage';
import type { Db } from '../db';
import { hasExecutableContract, praxisExport } from '../dataset/praxis-export';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { snapshotIdsForRecords } from './task-policy';

/**
 * Emitter for Anvil's per-Project policy manifest `praxis.anvil.project_policy.v1` (contracts/anvil/project-policy-v1,
 * docs/integrations/ANVIL-PROJECT-POLICY-V1.md). Built only from data Praxis already holds: published Project rule sets,
 * the policy document versions their rules cite, and the project's current approved records that carry an executable
 * contract. Mapping and defaults: docs/DECISIONS.md, 10 Nov 2026. Read-only: it writes nothing.
 */

/** Problems only the emitter can see (Praxis state that the manifest cannot represent), alongside the validator's. */
export type EmitterProblemCode = 'TASK_EXPORT_BLOCKED' | 'TASK_EXEMPTION_NOT_REPRESENTABLE' | 'RULE_WITHOUT_SOURCE' | 'UNSUPPORTED_INHERITANCE_MODE' | 'SNAPSHOT_RULE_SET_MISSING';
export interface ProjectPolicyProblem {
  code: ManifestProblem['code'] | EmitterProblemCode;
  path: string;
  message: string;
}

type RuleSetRule = ReturnType<typeof ProjectRuleSetContent.parse>['rules'][number];
type DocVersion = PolicyDocumentVersion & { document: PolicyDocument };

/** Conservative default: Praxis rules carry no severity, so every rule is exported as `high` (DECISIONS 10 Nov 2026). */
export const DEFAULT_RULE_SEVERITY = 'high' as const;
const EXT: Record<string, string> = { pdf: 'pdf', docx: 'docx', txt: 'txt', md: 'md' };

/**
 * Anvil's media type enum has no parameters; Praxis stores e.g. `text/markdown; charset=utf-8`. The detected format
 * (pdf, docx, txt, md) is canonical, so the type comes from it; an unknown format falls back to the stored essence.
 */
export const mediaTypeOf = (dv: { format: string; mediaType: string }) =>
  (POLICY_MEDIA_TYPES[dv.format as PolicyFormat] ?? dv.mediaType.split(';')[0]!.trim().toLowerCase()) as ProjectPolicyManifest['sources'][number]['media_type'];

export const sourcePath = (dv: { documentId: string; version: number; format: string }) => `policies/${dv.documentId}/v${dv.version}.${EXT[dv.format] ?? 'bin'}`;
export const policyVersion = (setVersion: number, docVersion: number) => `rs${setVersion}.d${docVersion}`;
export const ruleIdOf = (r: { ruleKey: string; ruleId: string }) => (PROJECT_POLICY_ID_PATTERN.test(r.ruleKey) ? r.ruleKey : `rule-${r.ruleId}`);
const VISIBILITY = { agent_visible: 'agent_instruction', evaluator_only: 'evaluator_only' } as const;

/** The citation that states the rule's requirement (review requires one); otherwise the first citation. */
function primarySource(r: RuleSetRule) {
  const req = r.sources.filter((s) => s.fieldPath === 'requirement' || s.fieldPath.startsWith('requirement.'));
  return req.find((s) => s.role === 'supports') ?? req[0] ?? r.sources[0] ?? null;
}

/** A locator only (page, lines, section, characters), never the quoted source text. */
export function sourceLocation(dv: { version: number }, locator: unknown): string {
  const l = (locator ?? {}) as { page?: number | null; renditionPage?: number | null; lineStart?: number | null; lineEnd?: number | null; charStart?: number | null; charEnd?: number | null; section?: string | null };
  const range = (a?: number | null, b?: number | null) => (a && b && b !== a ? `${a}-${b}` : String(a ?? b));
  const parts = [
    l.page ? `page ${l.page}` : '',
    l.renditionPage ? `page ${l.renditionPage} of a converted rendition` : '',
    l.lineStart || l.lineEnd ? `line${l.lineEnd && l.lineEnd !== l.lineStart ? 's' : ''} ${range(l.lineStart, l.lineEnd)}` : '',
    l.section ? `section ${l.section}` : '',
    l.charStart != null && l.charEnd != null ? `characters ${l.charStart}-${l.charEnd}` : '',
  ].filter(Boolean);
  return `document version ${dv.version}: ${parts.length ? parts.join('; ') : 'whole document (no finer locator recorded)'}`;
}

const sortRefs = (refs: AnvilPolicyRef[]) => [...refs].sort((a, b) => (a.policy_id === b.policy_id ? a.version.localeCompare(b.version) : a.policy_id.localeCompare(b.policy_id)));

export interface BuiltProjectPolicy {
  manifest: ProjectPolicyManifest;
  /** The exact response bytes (stable JSON) and their sha256. */
  bytes: Buffer;
  sha256: string;
  /** Exact source bytes by manifest path. */
  sources: Map<string, Buffer>;
  /** Empty when the manifest is valid. */
  problems: ProjectPolicyProblem[];
}

export async function buildProjectPolicyManifest(db: Db, storage: ObjectStorage, project: { id: string; clientId: string; name: string }): Promise<BuiltProjectPolicy> {
  const problems: ProjectPolicyProblem[] = [];
  const { id: projectId, clientId } = project;

  // Current approved records (corrections supersede; only the latest of each chain is exported) with a contract.
  const all = await db.approvedTaskRecord.findMany({ where: { clientId, projectId }, orderBy: { seq: 'asc' } });
  const superseded = new Set(all.map((r) => r.supersedesId).filter((x): x is string => !!x));
  const heads = all.filter((r) => !superseded.has(r.id) && hasExecutableContract(r));
  const exported: Array<{ record: ApprovedTaskRecord; export: ReturnType<typeof praxisExport> }> = [];
  for (const r of heads) {
    try {
      exported.push({ record: r, export: praxisExport(r) });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      problems.push({ code: 'TASK_EXPORT_BLOCKED', path: `records/${r.id}`, message: `${e.code}: ${e.message}` });
    }
  }

  // Rule sets: the latest published set (project defaults) plus the sets the records' frozen snapshots used.
  const snapIds = await snapshotIdsForRecords(db, exported.map((x) => x.record));
  const snaps = new Map((await db.taskPolicySnapshot.findMany({ where: { clientId, id: { in: [...new Set(snapIds.values())] } } })).map((s) => [s.id, s]));
  const latest = await db.projectRuleSet.findFirst({ where: { clientId, projectId }, orderBy: { version: 'desc' } });
  const setIds = new Set<string>([...(latest ? [latest.id] : []), ...[...snaps.values()].map((s) => s.ruleSetId)]);
  const sets = new Map((await db.projectRuleSet.findMany({ where: { clientId, projectId, id: { in: [...setIds] } } })).map((s) => [s.id, s]));

  const docVersionIds = new Set<string>();
  const contents = new Map<string, ReturnType<typeof ProjectRuleSetContent.parse>>();
  for (const s of sets.values()) {
    if (s.inheritanceMode !== 'ALL_TASKS') problems.push({ code: 'UNSUPPORTED_INHERITANCE_MODE', path: `rule_sets/${s.id}`, message: `Rule set version ${s.version} uses inheritance mode ${s.inheritanceMode}; only ALL_TASKS maps to project defaults.` });
    const c = ProjectRuleSetContent.parse(s.content);
    contents.set(s.id, c);
    for (const r of c.rules) for (const src of r.sources) docVersionIds.add(src.documentVersionId);
  }
  const docVersions = new Map<string, DocVersion>((await db.policyDocumentVersion.findMany({ where: { clientId, projectId, id: { in: [...docVersionIds] } }, include: { document: true } })).map((d) => [d.id, d]));

  // One Anvil policy per (rule set version, cited document version); each rule sits under its requirement's source.
  const policies = new Map<string, ProjectPolicyManifest['policies'][number]>();
  const usedDocs = new Map<string, DocVersion>();
  const policiesOfSet = (set: ProjectRuleSet): AnvilPolicyRef[] => {
    const refs = new Map<string, AnvilPolicyRef>();
    for (const r of contents.get(set.id)!.rules) {
      const src = primarySource(r);
      const dv = src ? docVersions.get(src.documentVersionId) : undefined;
      if (!src || !dv) {
        problems.push({ code: 'RULE_WITHOUT_SOURCE', path: `rule_sets/${set.id}/rules/${r.ruleKey}`, message: `Rule ${r.ruleKey} in rule set version ${set.version} has no policy document version in this project to cite.` });
        continue;
      }
      const ref = { policy_id: dv.documentId, version: policyVersion(set.version, dv.version) };
      const key = `${ref.policy_id}@${ref.version}`;
      refs.set(key, ref);
      usedDocs.set(dv.id, dv);
      const policy = policies.get(key) ?? { ...ref, title: dv.document.title, source_id: dv.id, rules: [] };
      if (!policy.rules.some((x) => x.rule_id === ruleIdOf(r))) {
        policy.rules.push({ rule_id: ruleIdOf(r), requirement: r.body.requirement, source_location: sourceLocation(dv, src.locator), severity: DEFAULT_RULE_SEVERITY, visibility: VISIBILITY[r.body.visibility] });
      }
      policies.set(key, policy);
    }
    return sortRefs([...refs.values()]);
  };
  const setRefs = new Map<string, AnvilPolicyRef[]>();
  const refsFor = (set: ProjectRuleSet) => setRefs.get(set.id) ?? setRefs.set(set.id, policiesOfSet(set)).get(set.id)!;
  const defaults = latest ? refsFor(latest) : [];
  const defaultKeys = new Set(defaults.map((d) => `${d.policy_id}@${d.version}`));

  const bindings: ProjectPolicyManifest['task_bindings'] = [];
  for (const { record, export: x } of exported) {
    const snap = snaps.get(snapIds.get(record.id) ?? '');
    let refs: AnvilPolicyRef[] = [];
    if (snap) {
      const set = sets.get(snap.ruleSetId);
      if (!set) problems.push({ code: 'SNAPSHOT_RULE_SET_MISSING', path: `records/${record.id}`, message: `The task's frozen policy snapshot refers to rule set ${snap.ruleSetId}, which is not in this project.` });
      else refs = refsFor(set);
      const changes = (snap.content as { task_changes?: Array<{ type: string; rule_version_id: string }> }).task_changes ?? [];
      for (const c of changes.filter((c) => c.type === 'EXEMPTION')) {
        problems.push({ code: 'TASK_EXEMPTION_NOT_REPRESENTABLE', path: `records/${record.id}`, message: `Task ${x.contract.task_id}@${x.contract.task_version} has an exemption from rule version ${c.rule_version_id}; the v1 manifest cannot exempt one rule, so it is not exported.` });
      }
    }
    const applied = new Set(refs.map((r) => `${r.policy_id}@${r.version}`));
    bindings.push({
      task_id: x.contract.task_id,
      task_version: x.contract.task_version,
      payload_sha256: x.payloadSha256,
      policy_refs: refs,
      excluded_project_policy_refs: defaults.filter((d) => !applied.has(`${d.policy_id}@${d.version}`)),
    });
  }

  // Sources: exact stored bytes of every cited document version.
  const sourceBytes = new Map<string, Buffer>();
  const sources: ProjectPolicyManifest['sources'] = [];
  for (const dv of [...usedDocs.values()].sort((a, b) => sourcePath(a).localeCompare(sourcePath(b)))) {
    const path = sourcePath(dv);
    sources.push({ id: dv.id, path, media_type: mediaTypeOf(dv), size_bytes: dv.sizeBytes, sha256: dv.sha256 });
    try {
      sourceBytes.set(path, await storage.get(dv.storageKey));
    } catch {
      // Left out: the validator reports SOURCE_BYTES_MISSING.
    }
  }

  const body = {
    schema_version: PROJECT_POLICY_SCHEMA_VERSION,
    project_default_policy_refs: defaults,
    sources,
    policies: [...policies.values()].filter((p) => defaultKeys.has(`${p.policy_id}@${p.version}`) || bindings.some((b) => b.policy_refs.some((r) => r.policy_id === p.policy_id && r.version === p.version)))
      .sort((a, b) => (a.policy_id === b.policy_id ? a.version.localeCompare(b.version) : a.policy_id.localeCompare(b.policy_id)))
      .map((p) => ({ ...p, rules: [...p.rules].sort((a, b) => a.rule_id.localeCompare(b.rule_id)) })),
    task_bindings: bindings,
  };
  // Project version is content-addressed: the same id and version always mean the same manifest content.
  const version = sha256(stableStringify({ ...body, source_project: { id: projectId, name: project.name } }));
  const manifest = { ...body, source_project: { id: projectId, version, name: project.name } } as ProjectPolicyManifest;
  const bytes = Buffer.from(stableStringify(manifest), 'utf8');
  problems.push(...validateProjectPolicyManifest(bytes, sourceBytes, { exports: exported.map((x) => x.export.envelope) }));
  return { manifest, bytes, sha256: sha256(bytes.toString('utf8')), sources: sourceBytes, problems };
}
