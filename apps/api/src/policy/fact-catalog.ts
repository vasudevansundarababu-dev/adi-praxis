import { conditionFacts, conditionLabel, FactCatalog, PolicyRuleBody } from '@praxis/shared';
import type { Db, Tx } from '../db';

/** The project scope's latest fact catalog (fact-catalog.v1), or null when the PM has not set one up. */
export async function projectFactCatalog(tx: Db | Tx, projectId: string): Promise<FactCatalog | null> {
  const row = await tx.projectFactCatalog.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
  if (!row) return null;
  const parsed = FactCatalog.safeParse(row.catalog);
  return parsed.success ? parsed.data : null;
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
  return FactCatalog.parse({ schema_version: 'adi.utility.fact-catalog.v1', catalog_id: 'project.facts', version: 1, owner: { kind: 'project_scope', id: projectId }, facts: unique });
}
