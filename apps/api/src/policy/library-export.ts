import { conditionProblems, derivedAsFact, ISO_JURISDICTION, PolicyRuleBody, type DerivedFactDef } from '@praxis/shared';
import type { Db, Tx } from '../db';
import { normaliseJurisdiction } from './enrich';
import { projectFactCatalog } from './fact-catalog';
import { sourceLocation } from './anvil-project-policy';
import { sourcePassage } from './source-text';
import { textSha256 } from './text-hash';

/**
 * KYC Judgment v1 A4 (owner, 25 Nov 2026; contract C1 policy-library.v1 at Studio 1ba841d): the project's policy library
 * as Studio's generator copies it and the RL Gym resolves it.
 * - Every approved rule of the project, distractors included, never filtered by the owner's mandatory marking. A rule
 *   whose latest version is excluded, or was unticked ("unapplied"), is left out; drafts never appear.
 * - Each rule carries its whole chain of approved (Reviewed) versions, oldest first, with Authoring's own version numbers
 *   (gaps allowed); an unapply/re-apply copy with the same content is collapsed into the version before it.
 * - Rule identity is (rule key, version, text_sha256); text_sha256 is the SHA-256 of the served text's UTF-8 bytes.
 * Never guessed: anything C1 requires that is missing is a problem, and the export is refused with the whole list.
 */
export { textSha256 };

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const LIBRARY_PARTS = ['kind', 'issuer', 'jurisdiction', 'subject', 'scope'] as const;

/** A document's jurisdiction as an ISO code (C1), or null when it can't be placed. */
export const isoJurisdiction = (j: string | null | undefined) => (j && ISO_JURISDICTION.test(j) ? j : normaliseJurisdiction(j));

/** Reads a document version's text (from storage), for C1 `source_text`. */
export type LoadText = (dv: { textStorageKey: string }) => Promise<{ text: string }>;

export async function buildPolicyLibrary(tx: Db | Tx, clientId: string, projectId: string, deps: { loadText?: LoadText } = {}) {
  const texts = new Map<string, Promise<string | null>>();
  const docText = (dv: { id: string; textStorageKey: string }) => {
    if (!deps.loadText) return Promise.resolve(null);
    if (!texts.has(dv.id)) texts.set(dv.id, deps.loadText(dv).then((t) => t.text).catch(() => null));
    return texts.get(dv.id)!;
  };
  const problems: string[] = [];
  const catalog = await projectFactCatalog(tx, projectId);
  if (!catalog) problems.push('The project has no fact catalog, so the conditions can’t be checked.');
  const rules = await tx.policyRule.findMany({
    where: { clientId, projectId },
    orderBy: { ruleKey: 'asc' },
    include: { versions: { orderBy: { version: 'asc' }, include: { citations: { include: { documentVersion: { include: { document: true } } } } } } },
  });

  type Version = (typeof rules)[number]['versions'][number];
  const included: { rule: (typeof rules)[number]; chain: Version[] }[] = [];
  for (const rule of rules) {
    const latest = rule.versions.at(-1);
    if (!latest || latest.state === 'EXCLUDED' || (latest.state !== 'REVIEWED' && latest.origin === 'unapplied')) continue;
    const chain: Version[] = [];
    for (const v of rule.versions.filter((x) => x.state === 'REVIEWED')) if (chain.at(-1)?.contentHash !== v.contentHash) chain.push(v);
    if (chain.length) included.push({ rule, chain });
  }

  // Derived facts: the latest approved definition of each (C1 derived_facts); conditions are checked with them.
  const defined = new Map<string, { fact: DerivedFactDef; ruleKey: string; version: number }>();
  for (const { rule, chain } of included)
    for (const v of chain) {
      const d = PolicyRuleBody.parse(v.body).library?.defines;
      if (d) defined.set(d.id, { fact: d, ruleKey: rule.ruleKey, version: v.version });
    }
  for (const d of defined.values()) for (const p of conditionProblems(d.fact.definition, catalog, `${d.ruleKey} defines ${d.fact.id}`)) problems.push(p);
  const checkCatalog = catalog ? { ...catalog, facts: [...catalog.facts, ...[...defined.values()].filter((d) => !catalog.facts.some((f) => f.id === d.fact.id)).map((d) => derivedAsFact(d.fact))] } : null;

  const documents = new Map<string, Version['citations'][number]['documentVersion']>();
  let versionCount = 0;
  const out = [];
  for (const { rule, chain } of included) {
    const latest = PolicyRuleBody.parse(chain.at(-1)!.body);
    const lib = latest.library ?? {};
    const missing = LIBRARY_PARTS.filter((k) => lib[k] === undefined);
    if (missing.length) problems.push(`${rule.ruleKey}: missing ${missing.join(', ')}.`);
    const versions = [];
    for (const [i, v] of chain.entries()) {
      versionCount++;
      const body = PolicyRuleBody.parse(v.body);
      const at = `${rule.ruleKey} v${v.version}`;
      const meta = body.library ?? {};
      const src = v.citations.find((c) => c.fieldPath === 'requirement' && c.resolution === 'RESOLVED' && c.role === 'supports') ?? v.citations.find((c) => c.fieldPath.startsWith('requirement') && c.resolution === 'RESOLVED');
      if (!src) problems.push(`${at}: no resolved source quote for its text.`);
      else documents.set(`${src.documentVersion.documentId}@${src.documentVersion.version}`, src.documentVersion);
      if (body.condition === undefined) problems.push(`${at}: the condition is not set (set one, or null for "always within its process").`);
      else for (const p of conditionProblems(body.condition, checkCatalog, `${at} condition`)) problems.push(p);
      let effective: Record<string, unknown>;
      if (meta.effectiveMode === 'scenario_only') {
        effective = { mode: 'scenario_only' };
        if (i === 0) problems.push(`${at}: the first version must be in force from a date, not scenario-only.`);
      } else {
        const from = body.effective.from ?? day(src?.documentVersion.document.effectiveFrom);
        if (!from) problems.push(`${at}: no date it is in force from (on the rule or its document).`);
        effective = { mode: 'from_date', from: from ?? '' };
      }
      if (i > 0 && !meta.change) problems.push(`${at}: say how it changes version ${chain[i - 1]!.version} (C1 change).`);
      if (!v.reviewedById || !v.reviewedAt) problems.push(`${at}: no approval recorded.`);
      const exceptions = body.exceptions.kind === 'listed' ? body.exceptions.items.map((e) => ({ text: e.statement })).filter((e) => e.text) : [];
      // C1 source_text (owner, 25 Nov 2026, spec §16): the verbatim passage with its context; which text the environment
      // serves (requirement or source text) is the environment's setting, so both travel.
      const full = src ? await docText(src.documentVersion) : null;
      const sourceText = src ? (full ? sourcePassage(full, src.quote, src.locator) : src.quote.trim()) : '';
      versions.push({
        version: v.version,
        ...(i > 0 ? { supersedes: chain[i - 1]!.version, ...(meta.change ? { change: meta.change } : {}) } : {}),
        text: body.requirement,
        text_sha256: textSha256(body.requirement),
        requirement: body.requirement,
        source_text: sourceText,
        source_text_sha256: textSha256(sourceText),
        effect: meta.effect ?? 'obligation',
        condition: body.condition ?? null,
        ...(exceptions.length ? { exceptions } : {}),
        effective,
        source: src ? { document_id: src.documentVersion.documentId, document_version: src.documentVersion.version, locator: sourceLocation(src.documentVersion, src.locator), quote: src.quote } : { document_id: '', document_version: 1, quote: '' },
        approval: { state: 'approved', approval_id: v.id, approved_by: v.reviewedById ?? '', approved_at: v.reviewedAt?.toISOString() ?? '' },
      });
    }
    out.push({ rule_id: rule.ruleKey, title: latest.title, kind: lib.kind, issuer: lib.issuer, jurisdiction: lib.jurisdiction, subject: lib.subject, scope: lib.scope, versions });
  }

  const docs = [...documents.values()]
    .sort((a, b) => a.documentId.localeCompare(b.documentId) || a.version - b.version)
    .map((dv) => {
      const d = dv.document;
      const jurisdiction = isoJurisdiction(d.jurisdiction);
      if (!d.libraryKind) problems.push(`${d.title}: no document kind (official text or bank policy).`);
      if (!jurisdiction) problems.push(d.jurisdiction ? `${d.title}: jurisdiction "${d.jurisdiction}" is not an ISO code (for example US, US-CA).` : `${d.title}: no jurisdiction.`);
      const official = d.libraryKind === 'official_text';
      if (official && (!d.captureSourceUrl || !d.captureDownloadedOn)) problems.push(`${d.title}: an official text needs where and when it was downloaded.`);
      return {
        document_id: dv.documentId,
        document_version: dv.version,
        title: d.title,
        kind: d.libraryKind,
        jurisdiction,
        sha256: dv.sha256,
        ...(official && d.captureSourceUrl && d.captureDownloadedOn ? { capture: { source_url: d.captureSourceUrl, downloaded_on: day(d.captureDownloadedOn), sha256: dv.sha256 } } : {}),
      };
    });
  if (!out.length) problems.push('No approved rule to export yet.');

  const content = {
    schema_version: 'adi.utility.policy-library.v1',
    library_id: `project-${projectId}.library`,
    fact_catalog: catalog ? `${catalog.catalog_id}@${catalog.version}` : '',
    documents: docs,
    derived_facts: [...defined.values()].sort((a, b) => a.fact.id.localeCompare(b.fact.id)).map((d) => ({ id: d.fact.id, type: d.fact.type, ...(d.fact.allowed_values ? { allowed_values: d.fact.allowed_values } : {}), definition: d.fact.definition, defined_by: { rule_id: d.ruleKey, version: d.version }, ...(d.fact.description ? { description: d.fact.description } : {}) })),
    rules: out,
  };
  return { content, problems, counts: { rules: out.length, versions: versionCount } };
}
