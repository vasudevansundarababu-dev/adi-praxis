import { conditionFacts, conditionLabel, conditionProblems, derivedAsFact, FactCatalog, PolicyRuleBody, type DerivedFactDef } from '@praxis/shared';
import type { Db, Tx } from '../db';

/** The project scope's latest fact catalog (fact-catalog.v1), or null when the PM has not set one up. */
export async function projectFactCatalog(tx: Db | Tx, projectId: string): Promise<FactCatalog | null> {
  const row = await tx.projectFactCatalog.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
  if (!row) return null;
  const parsed = FactCatalog.safeParse(row.catalog);
  return parsed.success ? parsed.data : null;
}

/** A derived fact (C1 derived_facts) and the rule version that defines it. */
export interface DefinedFact {
  fact: DerivedFactDef;
  ruleId: string;
  ruleKey: string;
  versionId: string;
  version: number;
  state: string;
}

/**
 * KYC Judgment v1 A1: the derived facts the project's rules define, from each rule's latest version (an excluded rule
 * defines nothing). Conditions may name them; the export lists the approved ones.
 */
export async function definedFacts(tx: Db | Tx, projectId: string): Promise<DefinedFact[]> {
  const rules = await tx.policyRule.findMany({ where: { projectId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: { ruleKey: 'asc' } });
  return rules.flatMap((r) => {
    const v = r.versions[0];
    if (!v || v.state === 'EXCLUDED') return [];
    const d = PolicyRuleBody.parse(v.body).library?.defines;
    return d ? [{ fact: d, ruleId: r.id, ruleKey: r.ruleKey, versionId: v.id, version: v.version, state: v.state }] : [];
  });
}

/** The catalog conditions are checked against: the project's facts plus the derived facts its rules define. */
export async function conditionCatalog(tx: Db | Tx, projectId: string): Promise<FactCatalog | null> {
  const catalog = await projectFactCatalog(tx, projectId);
  if (!catalog) return null;
  const derived = await definedFacts(tx, projectId);
  return { ...catalog, facts: [...catalog.facts, ...derived.filter((d) => !catalog.facts.some((f) => f.id === d.fact.id)).map((d) => derivedAsFact(d.fact))] };
}

/**
 * Problems with a rule's derived-fact definition: it may name catalog facts only (never another derived fact), its id
 * may not be a catalog fact, and no other rule of the project may define the same id.
 */
export async function derivedFactProblems(tx: Db | Tx, projectId: string, ruleId: string | null, def: DerivedFactDef): Promise<string[]> {
  const catalog = await projectFactCatalog(tx, projectId);
  const out = conditionProblems(def.definition, catalog, `defines.${def.id}`);
  if (catalog?.facts.some((f) => f.id === def.id)) out.push(`defines: ${def.id} is a fact in the catalog; a derived fact needs its own id.`);
  const other = (await definedFacts(tx, projectId)).find((d) => d.fact.id === def.id && d.ruleId !== ruleId);
  if (other) out.push(`defines: ${def.id} is already defined by ${other.ruleKey}.`);
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * template.v1 policies.policy_bindings (E-002, optional): the logical facts the template supplies. Read from a top-level
 * `policies`, or from the execution part where Authoring keeps Studio's rules. Null when the template has none, which
 * is every template today: then every clause with a condition is "setup needed".
 */
export function templateBoundFacts(anvilSpec: unknown): { factCatalog: string; facts: string[] } | null {
  if (!isObj(anvilSpec)) return null;
  const exec = isObj(anvilSpec.execution) ? anvilSpec.execution : {};
  const candidates = [isObj(anvilSpec.policies) ? anvilSpec.policies.policy_bindings : undefined, isObj(exec.policies) ? exec.policies.policy_bindings : undefined, exec.policy_bindings];
  const b = candidates.find(isObj);
  if (!b || !Array.isArray(b.facts)) return null;
  return { factCatalog: typeof b.fact_catalog === 'string' ? b.fact_catalog : '', facts: b.facts.filter(isObj).map((f) => String(f.fact ?? '')).filter(Boolean) };
}

/** The project's approved (Reviewed) clause versions, each with its condition in plain language and whether the template binds every fact it needs. */
export async function approvedClauses(tx: Db | Tx, clientId: string, projectId: string, anvilSpec: unknown) {
  const catalog = await projectFactCatalog(tx, projectId);
  const bound = templateBoundFacts(anvilSpec);
  const rules = await tx.policyRule.findMany({ where: { clientId, projectId }, include: { versions: { where: { state: 'REVIEWED' }, orderBy: { version: 'desc' }, take: 1, include: { citations: { include: { documentVersion: { select: { id: true, sha256: true, version: true, documentId: true } } } } } } }, orderBy: { ruleKey: 'asc' } });
  return rules.flatMap((r) => {
    const v = r.versions[0];
    if (!v) return [];
    const body = PolicyRuleBody.parse(v.body);
    const condition = body.condition ?? null;
    const facts = conditionFacts(condition);
    const missing = bound ? facts.filter((f) => !bound.facts.includes(f)) : facts;
    const src = v.citations[0]?.documentVersion ?? null;
    return [{
      clauseId: r.ruleKey,
      ruleId: r.id,
      versionId: v.id,
      version: v.version,
      title: body.title,
      condition,
      conditionText: conditionLabel(condition, catalog),
      exceptions: body.exceptions,
      facts,
      // "setup needed": the condition uses a fact the template does not bind (shown, never hidden).
      status: missing.length ? ('setup_needed' as const) : ('available' as const),
      missingFacts: missing,
      source: src ? { documentId: src.documentId, documentVersionId: src.id, documentVersion: src.version, sha256: src.sha256 } : null,
      approval: v.reviewedAt ? { approvalId: v.id, approvedById: v.reviewedById, approvedAt: v.reviewedAt.toISOString() } : null,
      bindingRevision: bound?.factCatalog || null,
    }];
  });
}

/**
 * A first project fact catalog from the facts the template binds (policy_bindings.facts), so the PM does not have to
 * type JSON. A binding entry may carry type, label and allowed_values (fact-catalog.v1 fields); otherwise the fact is
 * text, available from case data. The PM can edit it afterwards; saving makes a new version.
 */
export function catalogFromTemplate(anvilSpec: unknown, projectId: string): FactCatalog | null {
  if (!isObj(anvilSpec)) return null;
  const exec = isObj(anvilSpec.execution) ? anvilSpec.execution : {};
  const b = [isObj(anvilSpec.policies) ? anvilSpec.policies.policy_bindings : undefined, isObj(exec.policies) ? exec.policies.policy_bindings : undefined, exec.policy_bindings].find(isObj);
  if (!b || !Array.isArray(b.facts)) return null;
  const facts = b.facts.filter(isObj).flatMap((f) => {
    const id = typeof f.fact === 'string' ? f.fact : '';
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(id)) return [];
    const type = ['string', 'number', 'boolean', 'date', 'enum'].includes(f.type as string) ? (f.type as FactCatalog['facts'][number]['type']) : 'string';
    const allowed = Array.isArray(f.allowed_values) ? f.allowed_values.filter((v) => ['string', 'number', 'boolean'].includes(typeof v)) as (string | number | boolean)[] : undefined;
    const label = typeof f.label === 'string' && f.label ? f.label : id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    return [{ id, label, type: allowed?.length && type === 'string' ? ('enum' as const) : type, ...(allowed?.length ? { allowed_values: allowed } : {}), availability: 'case_data' }];
  });
  if (!facts.length) return null;
  const unique = facts.filter((f, i) => facts.findIndex((x) => x.id === f.id) === i);
  // KYC Judgment v1 (C1/C2): bindings that name the environment's catalog ("<id>@<version>") give it that identity, so the
  // policy library names the catalog the environment resolves conditions with.
  const env = typeof b.fact_catalog === 'string' ? /^([a-z][a-z0-9_.:-]{1,199})@([1-9][0-9]*)$/.exec(b.fact_catalog) : null;
  if (env) return FactCatalog.parse({ schema_version: 'adi.utility.fact-catalog.v1', catalog_id: env[1], version: Number(env[2]), owner: { kind: 'environment_version', id: b.fact_catalog }, facts: unique });
  return FactCatalog.parse({ schema_version: 'adi.utility.fact-catalog.v1', catalog_id: 'project.facts', version: 1, owner: { kind: 'project_scope', id: projectId }, facts: unique });
}
