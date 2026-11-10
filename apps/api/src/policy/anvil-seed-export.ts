/**
 * Fictional SEED handoff for Anvil: per task, an executable `praxis.anvil.task.v1` contract with its rubric and the
 * frozen policy sidecar; per project, the source documents and a proposed `anvil.policy-import.v1-proposed` manifest.
 * Drafts only: no review, approval or rights clearance is claimed. Run through `scripts/anvil-seed-export.ts`.
 */
import { praxisContractIssues, type PraxisTaskContract } from '@praxis/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MemoryStorage } from '../candidate/storage';
import type { Db } from '../db';
import { policySeed, SEED_PROJECTS } from '../jobs/policy-seed';
import { sha256, stableStringify } from '../lib/crypto';
import { contentHashV2, POLICY_SIDECAR_V2, ruleHashInput, sidecarV2 } from './snapshot-v2';
import { sidecar } from './task-policy';

type Binding = PraxisTaskContract['constraints'][number]['binding'];
interface Rule { rule_key: string; requirement: string; requirement_type: string; visibility: string; sources: { quote: string }[] }
interface Variant {
  title: string;
  objective: string;
  evidence: string;
  privateNote: string;
  outputDescription: string;
  /** Constraint IDs are `policy-<rule_key>` when they enforce a published rule. */
  constraints: { id: string; description: string; hard: boolean; binding: Binding }[];
  criteria: { id: string; description: string; weight: number; binding: Binding }[];
  reference: Record<string, string | number | boolean>;
}
interface Workflow {
  slug: string;
  code: string;
  rubricSource: string;
  variants: [Variant, Variant];
}

const eq = (field: string, value: string | number | boolean): Binding => ({ kind: 'json_equals', field, value });
const max = (field: string, value: number): Binding => ({ kind: 'json_number_max', field, value });
const min = (field: string, value: number): Binding => ({ kind: 'json_number_min', field, value });

const phone = (budget: number, weeks: number, good: string, bad: string, keyword: string, intent: string): Variant => {
  const weekly = budget / weeks;
  return {
    title: `SEED Quietline X launch plan (${keyword})`,
    objective: `Plan the fictional Quietline X launch. Write /workspace/output.json with weekly_spend_usd (number), headline_id (string), primary_keyword_intent (string) and launch_event_requires_approval (boolean).`,
    evidence: `Fictional launch brief. Total paid media budget $${budget.toLocaleString('en-US')} over ${weeks} weeks, paced evenly. Candidate headlines: ${good}; ${bad}. Primary keyword "${keyword}" (oracle intent ${intent}). A customer-facing launch event is planned.`,
    privateNote: `Verifier-only SEED canary: PRIVATE-QUIETLINE-${weeks}${weekly}. Never actor material.`,
    outputDescription: 'JSON object with weekly_spend_usd, headline_id, primary_keyword_intent and launch_event_requires_approval.',
    constraints: [
      { id: 'policy-weekly_spend_cap', description: 'Never spend more than $20,000 in a single week.', hard: true, binding: max('weekly_spend_usd', 20000) },
      { id: 'spend-nonnegative', description: 'Weekly spend is not negative.', hard: true, binding: min('weekly_spend_usd', 0) },
      { id: 'policy-no_unsubstantiated_claims', description: 'Choose the headline without medical, guarantee or total-silence claims.', hard: true, binding: eq('headline_id', good.split(' ')[0]!) },
      { id: 'policy-event_approval', description: 'A customer-facing launch event needs written manager approval first.', hard: true, binding: eq('launch_event_requires_approval', true) },
    ],
    criteria: [
      { id: 'keyword_intent', description: 'Keyword intent matches the oracle.', weight: 5000, binding: eq('primary_keyword_intent', intent) },
      { id: 'budget_pacing', description: `Budget paced evenly: at least $${weekly.toLocaleString('en-US')} a week.`, weight: 3000, binding: min('weekly_spend_usd', weekly) },
      { id: 'ad_coverage', description: 'A compliant headline is selected.', weight: 2000, binding: eq('headline_id', good.split(' ')[0]!) },
    ],
    reference: { weekly_spend_usd: weekly, headline_id: good.split(' ')[0]!, primary_keyword_intent: intent, launch_event_requires_approval: true },
  };
};

const locale = (loc: string, currency: string, term: string, wrongTerm: string, imprint: boolean): Variant => ({
  title: `SEED ${loc} creative localisation`,
  objective: `Localise the fictional Quietline X banner for ${loc}. Write /workspace/output.json with locale (string), price_currency (string), glossary_term (string) and imprint_link_included (boolean).`,
  evidence: `Fictional brief for market ${loc}. Approved glossary term for "quiet mode": "${term}" (not "${wrongTerm}"). Market currency ${currency}. ${imprint ? 'German creatives must link the legal imprint.' : 'No imprint link is required in this market.'}`,
  privateNote: `Verifier-only SEED canary: PRIVATE-LOCALE-${loc}. Never actor material.`,
  outputDescription: 'JSON object with locale, price_currency, glossary_term and imprint_link_included.',
  constraints: [
    { id: 'policy-local_currency', description: 'Show prices in the local currency of the market.', hard: true, binding: eq('price_currency', currency) },
    { id: 'policy-approved_glossary', description: 'Use the approved glossary term for the locale.', hard: false, binding: eq('glossary_term', term) },
    ...(imprint ? [{ id: 'policy-de_imprint', description: 'German creatives include the legal imprint link.', hard: true, binding: eq('imprint_link_included', true) }] : []),
  ],
  criteria: [
    { id: 'locale_match', description: 'Creative targets the requested locale.', weight: 3000, binding: eq('locale', loc) },
    { id: 'currency_correct', description: 'Price shown in the market currency.', weight: 4000, binding: eq('price_currency', currency) },
    { id: 'glossary_used', description: 'Approved glossary term used.', weight: 3000, binding: eq('glossary_term', term) },
  ],
  reference: { locale: loc, price_currency: currency, glossary_term: term, imprint_link_included: imprint },
});

const kyb = (company: string, owners: string, ubos: number, chains: number, decision: string): Variant => ({
  title: `SEED KYB review: ${company}`,
  objective: `Review the fictional business applicant ${company}. Write /workspace/output.json with ubo_count (number), chains_traced (number), decision (string: RECOMMEND_APPROVE, RECOMMEND_REFER or RECOMMEND_DECLINE), auto_approved (boolean) and rationale_quotes_identity_numbers (boolean).`,
  evidence: `Fictional ownership register for ${company}: ${owners} Screening: no sanctions or adverse-media hits for any named person.`,
  privateNote: `Verifier-only SEED canary: PRIVATE-KYB-${company.replace(/\W/g, '').toUpperCase()}. Never actor material.`,
  outputDescription: 'JSON object with ubo_count, chains_traced, decision, auto_approved and rationale_quotes_identity_numbers.',
  constraints: [
    { id: 'policy-no_auto_approval', description: 'The agent recommends; it never auto-approves a customer.', hard: true, binding: eq('auto_approved', false) },
    { id: 'policy-no_identity_numbers', description: 'Rationales never quote identity document numbers or dates of birth.', hard: true, binding: eq('rationale_quotes_identity_numbers', false) },
  ],
  criteria: [
    { id: 'ubo_identification', description: 'Every owner holding 25% or more identified.', weight: 4500, binding: eq('ubo_count', ubos) },
    { id: 'ownership_chains', description: 'Ownership chains traced to a person.', weight: 2500, binding: eq('chains_traced', chains) },
    { id: 'recommendation', description: 'Recommendation follows the evidence.', weight: 3000, binding: eq('decision', decision) },
  ],
  reference: { ubo_count: ubos, chains_traced: chains, decision, auto_approved: false, rationale_quotes_identity_numbers: false },
});

const aml = (alerts: string, escalated: number, total: number, typology: string): Variant => ({
  title: `SEED AML alert batch (${typology})`,
  objective: `Disposition the fictional alert batch. Write /workspace/output.json with escalated_count (number), dispositioned_count (number), typology (string), disposition_reason_provided (boolean), customer_message_mentions_suspicion (boolean) and customer_exit_initiated (boolean).`,
  evidence: `Fictional alerts: ${alerts}`,
  privateNote: `Verifier-only SEED canary: PRIVATE-AML-${typology.toUpperCase()}. Never actor material.`,
  outputDescription: 'JSON object with escalated_count, dispositioned_count, typology, disposition_reason_provided, customer_message_mentions_suspicion and customer_exit_initiated.',
  constraints: [
    { id: 'policy-no_tipping_off', description: 'Customer messages never mention suspicion, investigations or reports.', hard: true, binding: eq('customer_message_mentions_suspicion', false) },
    { id: 'policy-no_customer_exit', description: 'Exiting a customer is a human decision; the agent never does it.', hard: true, binding: eq('customer_exit_initiated', false) },
    { id: 'policy-disposition_reason', description: 'Every disposition states its reason in plain language.', hard: false, binding: eq('disposition_reason_provided', true) },
  ],
  criteria: [
    { id: 'escalation_set', description: 'The right alerts escalated.', weight: 4000, binding: eq('escalated_count', escalated) },
    { id: 'dispositions', description: 'Every alert dispositioned once.', weight: 3000, binding: eq('dispositioned_count', total) },
    { id: 'case_summary', description: 'Case summary names the typology.', weight: 3000, binding: eq('typology', typology) },
  ],
  reference: { escalated_count: escalated, dispositioned_count: total, typology, disposition_reason_provided: true, customer_message_mentions_suspicion: false, customer_exit_initiated: false },
});

const kyc = (name: string, ageDays: number, screened: boolean, risk: string): Variant => {
  const accept = ageDays <= 92;
  const open = accept && screened;
  return {
    title: `SEED KYC onboarding: ${name}`,
    objective: `Decide whether the fictional applicant ${name} can be onboarded. Write /workspace/output.json with address_proof_age_days (number), address_proof_accepted (boolean), sanctions_screening_complete (boolean), account_open_recommended (boolean) and refresh_interval_months (number).`,
    evidence: `Fictional file for ${name}: proof of address is a utility bill ${ageDays} days old; sanctions screening ${screened ? 'completed with no match' : 'not yet run'}; customer risk rating ${risk}.`,
    privateNote: `Verifier-only SEED canary: PRIVATE-KYC-${name.replace(/\W/g, '').toUpperCase()}. Never actor material.`,
    outputDescription: 'JSON object with address_proof_age_days, address_proof_accepted, sanctions_screening_complete, account_open_recommended and refresh_interval_months.',
    constraints: [
      { id: 'policy-screen_before_open', description: 'No account opening is recommended before sanctions screening is complete.', hard: true, binding: eq('account_open_recommended', open) },
      { id: 'policy-high_risk_refresh', description: 'High-risk customers are reviewed at least every 12 months.', hard: true, binding: max('refresh_interval_months', 12) },
    ],
    criteria: [
      { id: 'address_check', description: 'Proof of address accepted only within three months.', weight: 4000, binding: eq('address_proof_accepted', accept) },
      { id: 'screening_check', description: 'Screening status reported correctly.', weight: 3000, binding: eq('sanctions_screening_complete', screened) },
      { id: 'decision', description: 'Onboarding recommendation follows the checklist.', weight: 3000, binding: eq('account_open_recommended', open) },
    ],
    reference: { address_proof_age_days: ageDays, address_proof_accepted: accept, sanctions_screening_complete: screened, account_open_recommended: open, refresh_interval_months: 12 },
  };
};

const WORKFLOWS: Record<string, Workflow> = {
  'Launch of Noise Cancelling Phone': {
    slug: 'phone-launch', code: 'PHONE', rubricSource: 'Catalog blueprint milestones (keyword_intent 50, budget_pacing 30, ad_coverage 20).',
    variants: [
      phone(216000, 12, 'H1 "Focus mode for busy commutes"', 'H2 "Guaranteed 100% silence"', 'noise cancelling phone', 'BUY'),
      phone(180000, 12, 'H4 "Hear your music, not the train"', 'H3 "Cures sleepless nights"', 'quiet phone for travel', 'RESEARCH'),
    ],
  },
  'Omnichannel Creative & Locale Compliance': {
    slug: 'locale-compliance', code: 'LOCALE', rubricSource: 'Fictional SEED rubric: this template has no catalog blueprint yet.',
    variants: [locale('de-DE', 'EUR', 'Ruhemodus', 'Stillmodus', true), locale('fr-FR', 'EUR', 'mode silence', 'mode muet', false)],
  },
  'KYB and beneficial ownership': {
    slug: 'kyb-review', code: 'KYB', rubricSource: 'Catalog blueprint milestones (ubo_identification 45, ownership_chains 25, recommendation 30).',
    variants: [
      kyb('Alder & Birch Trading Ltd', 'Person A holds 40% directly; Person B holds 100% of Cedar Holdings, which holds 35%; 25 retail holders hold 1% each.', 2, 2, 'RECOMMEND_APPROVE'),
      kyb('Juniper Logistics GmbH', 'Person C holds 30% directly; Oak Nominees holds 45% with no disclosed owner; 25 holders hold 1% each.', 1, 1, 'RECOMMEND_REFER'),
    ],
  },
  'AML transaction-monitoring alerts': {
    slug: 'aml-alerts', code: 'AML',
    rubricSource: 'Catalog blueprint milestones (escalation_set 40, dispositions 30, case_summary 30).',
    variants: [
      aml('A1 nine cash deposits of $9,500 within five days; A2 monthly salary credit; A3 one card refund of $40.', 1, 3, 'structuring'),
      aml('B1 incoming wire then same-day outgoing wires to four new beneficiaries; B2 rent payment; B3 utility payment; B4 payroll credit.', 1, 4, 'rapid_movement'),
    ],
  },
  'KYC onboarding and refresh': {
    slug: 'kyc-onboarding', code: 'KYC', rubricSource: 'Fictional SEED rubric: this workflow uses the KYC task definition, not a catalog blueprint.',
    variants: [kyc('Applicant R. Varma', 69, true, 'HIGH'), kyc('Applicant L. Moreau', 140, true, 'HIGH')],
  },
};

function contract(id: string, v: Variant): PraxisTaskContract {
  const revision = `${id.toLowerCase()}-r1`;
  return {
    schema_version: 'praxis.anvil.task.v1',
    task_id: id,
    task_version: '1.0.0',
    revision_id: revision,
    title: v.title,
    objective: v.objective,
    evidence: [
      { id: 'ev-brief', visibility: 'actor', content: v.evidence },
      { id: 'ev-private-note', visibility: 'private', content: v.privateNote },
    ],
    constraints: v.constraints.map((c) => ({ id: c.id, description: c.description, hard_failure: c.hard, binding: c.binding })),
    environment: { binding: 'structured-decision-v1', initial_state: { fictional: true, seed: true } },
    actions: [{ id: 'action-submit', description: 'Write a final JSON decision to /workspace/output.json; there are no external side effects.' }],
    stages: [{ id: 'stage-decision', instruction: 'Read the brief and submit the decision.', evidence_ids: ['ev-brief'], completion: 'Write /workspace/output.json' }],
    deliverables: [{ id: 'deliverable-decision', path: 'output.json', description: v.outputDescription }],
    rubric: { criteria: v.criteria.map((c) => ({ id: c.id, description: c.description, weight_bps: c.weight, binding: c.binding })), reference_output: v.reference },
    provenance: {
      classification: 'synthetic',
      source: 'Praxis policy SEED fixture. Fictional company, people and data; no customer material.',
      rights: { status: 'declared', basis: 'Original synthetic fixture authored for the Praxis–Anvil integration. Not a reviewed rights clearance.' },
      review: { status: 'draft', reviewer_ref: 'not-reviewed', reviewed_revision_id: revision },
    },
  };
}

const severity = (r: Rule) => (r.requirement_type === 'prohibition' ? 'critical' : 'high');

function policyImport(slug: string, policyId: string, title: string, doc: { path: string; sha256: string; text: string }, rules: Rule[], tasks: { id: string; c: PraxisTaskContract }[]) {
  const constraintIds = new Set(tasks.flatMap((t) => t.c.constraints.map((c) => c.id)));
  const line = (quote: string) => {
    const i = doc.text.split('\n').findIndex((l) => l.includes(quote.slice(0, 40)));
    return i >= 0 ? `Line ${i + 1}` : 'Document';
  };
  return {
    schema_version: 'anvil.policy-import.v1-proposed',
    task_group_id: `seed-${slug}`,
    task_group_version: '1.0.0',
    source_revision: 'PRAXIS-SEED-FICTIONAL',
    group_default_policy_refs: [{ policy_id: policyId, version: '1.0.0' }],
    policies: [{
      policy_id: policyId,
      version: '1.0.0',
      title,
      source: { path: doc.path, media_type: 'text/markdown', sha256: doc.sha256 },
      rules: rules.map((r) => {
        const cid = `policy-${r.rule_key.replace(/^R-/, '')}`;
        return {
          rule_id: r.rule_key,
          requirement: r.requirement,
          severity: severity(r),
          visibility: r.visibility === 'evaluator_only' ? 'evaluator_only' : 'agent_instruction',
          source_location: line(r.sources[0]?.quote ?? ''),
          ...(constraintIds.has(cid)
            ? { evaluator: { type: 'task_constraint_binding', expectation: `Constraint ${cid} in the task contract holds on output.json.`, on_missing_evidence: 'unknown', profile_ref: { evaluator_id: 'anvil.task-constraint-binding', version: '1.0.0-proposed' } } }
            : {}),
        };
      }),
    }],
    evaluator_profiles: [{
      evaluator_id: 'anvil.task-constraint-binding',
      version: '1.0.0-proposed',
      engine: 'builtin',
      input_schema: 'task-output-json.v1-proposed',
      output_schema: 'rule-outcome.v1-proposed',
      configuration: { constraint_id_prefix: 'policy-', binding_kinds: ['json_equals', 'json_number_min', 'json_number_max'], missing_evidence_outcome: 'unknown' },
      case_set_ref: `praxis-seed/${slug}-reference-outputs-v1`,
    }],
    task_bindings: tasks.map((t) => ({ task_id: t.id, policy_refs: [{ policy_id: policyId, version: '1.0.0' }] })),
  };
}

const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** Seeds a new client (5 SEED projects, 2 draft tasks each). Every call creates new database IDs. */
async function seedClient(db: Db) {
  const storage = new MemoryStorage();
  const client = await db.client.create({ data: { name: `SEED Anvil export ${randomUUID()}` } });
  const pm = await db.user.create({ data: { clientId: client.id, email: `seed-pm-${randomUUID()}@seed.invalid`, name: 'SEED owner (fixture)', roles: ['PM'], passwordHash: 'no-login' } });
  const domain = await db.domain.create({ data: { clientId: client.id, name: 'SEED fixtures' } });
  for (const sp of SEED_PROJECTS) await db.template.create({ data: { clientId: client.id, domainId: domain.id, lineageId: randomUUID(), workflowName: sp.workflow, status: 'PUBLISHED' } });
  const seeded = await policySeed(db, { storage, appEnv: 'local', clientId: client.id, ownerId: pm.id });
  if (seeded.created.length !== SEED_PROJECTS.length) throw new Error(`Seed created ${seeded.created.length} projects`);
  return { client, storage };
}

async function firstSnapshot(db: Db, clientId: string, projectName: string) {
  const task = await db.taskInstance.findFirstOrThrow({ where: { project: { clientId, name: projectName } }, orderBy: { createdAt: 'asc' } });
  return db.taskPolicySnapshot.findFirstOrThrow({ where: { taskInstanceId: task.id }, orderBy: { version: 'desc' } });
}

/**
 * Evidence for the v2 hash rule from two real seeds: the same fictional content seeded into a second client gets new
 * database IDs but the same content hashes; editing one requirement gives that rule (and the snapshot) a new hash.
 */
async function hashStabilityExample(db: Db, firstClientId: string, taskRef: string, projectName: string) {
  const second = await seedClient(db);
  const a = sidecarV2(await firstSnapshot(db, firstClientId, projectName), { taskRef });
  const b = sidecarV2(await firstSnapshot(db, second.client.id, projectName), { taskRef });
  const ra = a.rules[0]!;
  const rb = b.rules.find((r) => r.rule_key === ra.rule_key)!;
  const v1Rule = (await firstSnapshot(db, firstClientId, projectName)).content as unknown as { rules: Parameters<typeof ruleHashInput>[0][] };
  const original = v1Rule.rules.find((r) => r.rule_key === ra.rule_key)!;
  const edited = { ...original, requirement: `${original.requirement} Record the approver's name.` };
  const editedHash = contentHashV2(ruleHashInput(edited));
  const editedSnapshotHash = contentHashV2({ rules: a.rules.map((r) => (r.rule_key === ra.rule_key ? editedHash : r.content_hash)).sort(), task_changes: a.task_changes.map((x) => x.content_hash).sort() });
  const ids = (s: typeof a, r: typeof ra) => ({ snapshot_id: s.provenance.snapshot_id, rule_version_id: r.provenance.rule_version_id, document_version_id: r.sources[0]!.provenance.document_version_id });
  return {
    description: 'Generated by the exporter from two separate seeds of the same fictional content, plus one edited requirement.',
    hash_algorithm: a.hash_algorithm,
    task_ref: taskRef,
    rule_key: ra.rule_key,
    rule_hash_input: ruleHashInput(original),
    reseed: {
      seed_a: { database_ids: ids(a, ra), rule_content_hash: ra.content_hash, snapshot_content_hash: a.content_hash },
      seed_b: { database_ids: ids(b, rb), rule_content_hash: rb.content_hash, snapshot_content_hash: b.content_hash },
      database_ids_differ: ids(a, ra).rule_version_id !== ids(b, rb).rule_version_id,
      content_hashes_equal: ra.content_hash === rb.content_hash && a.content_hash === b.content_hash,
    },
    changed_content: {
      edit: { field: 'requirement', before: original.requirement, after: edited.requirement },
      rule_content_hash: editedHash,
      snapshot_content_hash: editedSnapshotHash,
      rule_hash_changed: editedHash !== ra.content_hash,
      snapshot_hash_changed: editedSnapshotHash !== a.content_hash,
    },
  };
}

/**
 * Seeds a fresh client in `db` (5 SEED projects, 2 draft tasks each) and writes the Anvil handoff to `out`.
 * `policy: 'v2'` writes the v2 sidecar and the reseed example instead of v1; the v1 output is unchanged.
 * The caller owns the database: point it at a scratch database, never a shared one.
 */
export async function exportAnvilSeed(db: Db, out: string, opts: { policy?: 'v1' | 'v2' } = {}): Promise<{ projects: number; tasks: number }> {
  const v2 = opts.policy === 'v2';
  const { client, storage } = await seedClient(db);

  const index: unknown[] = [];
  for (const sp of SEED_PROJECTS) {
    const wf = WORKFLOWS[sp.workflow];
    if (!wf) throw new Error(`No export definition for ${sp.workflow}`);
    const dir = path.join(out, wf.slug);
    mkdirSync(path.join(dir, 'tasks'), { recursive: true });
    mkdirSync(path.join(dir, 'documents'), { recursive: true });
    const project = await db.project.findFirstOrThrow({ where: { clientId: client.id, name: sp.name }, include: { tasks: { orderBy: { createdAt: 'asc' } } } });

    const docs = await db.policyDocumentVersion.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } });
    const docFiles = [];
    for (const [i, d] of docs.entries()) {
      const bytes = await storage.get(d.storageKey);
      const name = i === 0 ? 'policy.md' : `unpublished-conflict-${i}.md`;
      writeFileSync(path.join(dir, 'documents', name), bytes);
      docFiles.push({ path: `documents/${name}`, sha256: d.sha256, document_version_id: d.id, title: d.fileName, text: bytes.toString('utf8'), published: i === 0 });
    }

    const tasks = [];
    for (const [n, t] of project.tasks.entries()) {
      const id = `SEED-${wf.code}-00${n + 1}`;
      const c = contract(id, wf.variants[n]!);
      const issues = praxisContractIssues(c);
      if (issues.length) throw new Error(`${id} invalid: ${JSON.stringify(issues)}`);
      const snap = await db.taskPolicySnapshot.findFirstOrThrow({ where: { taskInstanceId: t.id }, orderBy: { version: 'desc' } });
      const policy = sidecar(snap);
      const policyV2 = v2 ? sidecarV2(snap, { taskRef: id }) : null;
      writeFileSync(path.join(dir, 'tasks', `${id}.task.json`), pretty(c));
      writeFileSync(path.join(dir, 'tasks', `${id}.policy.json`), pretty(policyV2 ?? policy));
      tasks.push({ id, c, policy, policyV2, instance: t.id });
    }

    const rules = tasks[0]!.policy.rules as unknown as Rule[];
    const manifest = policyImport(wf.slug, `seed-${wf.slug}-policy`, sp.document.title, { path: docFiles[0]!.path, sha256: docFiles[0]!.sha256, text: docFiles[0]!.text }, rules, tasks);
    writeFileSync(path.join(dir, 'policy-import.json'), pretty(manifest));

    index.push({
      workflow: sp.workflow,
      project: sp.name,
      folder: wf.slug,
      rubric_source: wf.rubricSource,
      policy_import: `${wf.slug}/policy-import.json`,
      documents: docFiles.map(({ text: _t, ...d }) => ({ ...d, path: `${wf.slug}/${d.path}` })),
      tasks: tasks.map((t) => ({
        task_id: t.id,
        title: t.c.title,
        task: `${wf.slug}/tasks/${t.id}.task.json`,
        task_payload_sha256: sha256(stableStringify(t.c)),
        policy: `${wf.slug}/tasks/${t.id}.policy.json`,
        praxis_task_instance_id: t.instance,
        policy_snapshot_id: t.policy.snapshot_id,
        ...(t.policyV2 ? { policy_content_hash: t.policyV2.content_hash } : { policy_digest: t.policy.digest }),
        rules: t.policy.rules.length,
        task_changes: t.policy.task_changes.length,
        review_status: 'draft',
      })),
    });
  }
  if (v2) {
    const first = SEED_PROJECTS[0]!;
    mkdirSync(path.join(out, 'examples'), { recursive: true });
    writeFileSync(path.join(out, 'examples', 'hash-stability.json'), pretty(await hashStabilityExample(db, client.id, `SEED-${WORKFLOWS[first.workflow]!.code}-001`, first.name)));
  }
  writeFileSync(path.join(out, 'index.json'), pretty({
    schema: v2 ? 'praxis.seed-anvil-handoff.v2-proposed' : 'praxis.seed-anvil-handoff.v1-proposed',
    ...(v2 ? { policy_schema_version: POLICY_SIDECAR_V2, hash_stability_example: 'examples/hash-stability.json' } : {}),
    generated_at: new Date().toISOString(),
    fictional: true,
    projects: index,
  }));
  return { projects: index.length, tasks: index.length * 2 };
}
