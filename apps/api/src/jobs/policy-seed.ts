import type { CandidateRule, PolicyRuleBody } from '@praxis/shared';
import type { ObjectStorage } from '../candidate/storage';
import { stubScanner } from '../candidate/storage';
import type { Db, Tx } from '../db';
import { writeAudit, type AuditInput } from '../platform/audit';
import { addDocumentVersion, loadVersionText } from '../policy/documents';
import { publishRuleSet } from '../policy/rule-sets';
import { createRuleFromCandidate, markReviewed } from '../policy/rules';
import { addChange, snapshotTask } from '../policy/task-policy';

/**
 * Policy seed (PRD PR-S01–S05, OD7; architecture §12). Fictional design fixtures only: every project, document and task
 * is labelled SEED, rules are attributed to the seed job actor (not a person), tasks stay drafts with no reviews or
 * results. Idempotent: an existing SEED project is left as it is. Refuses production.
 */
export const SEED_ACTOR = 'policy-seed';
export const SEED_PREFIX = 'SEED — ';

type Applies = Partial<PolicyRuleBody['applicability']>;
interface SeedRule {
  key: string;
  title: string;
  requirement: string;
  type: PolicyRuleBody['requirementType'];
  quote: string;
  applies?: Applies;
  exceptions?: string[];
  evidence?: string[];
  visibility?: PolicyRuleBody['visibility'];
}
interface SeedProject {
  workflow: string;
  name: string;
  document: { title: string; text: string };
  rules: SeedRule[];
  change: { rule: string; requirement: string; reason: string };
  /** A second source line for the same rule key with different content: the deliberate, unpublished conflict (PR-R10). */
  conflict?: SeedRule;
}

const header = (t: string) => `${t}\nFICTIONAL SEED FIXTURE — not a real policy. Created by the Praxis policy seed for demonstration and testing only.\n`;

/** Blueprint hard-fail invariants keep their IDs as rule keys (PR-S02); blueprints themselves are unchanged. */
export const SEED_PROJECTS: SeedProject[] = [
  {
    workflow: 'Launch of Noise Cancelling Phone',
    name: `${SEED_PREFIX}Phone launch`,
    document: {
      title: 'Phone launch marketing policy (fictional)',
      text: `${header('Phone launch marketing policy')}
1. Weekly paid media spend must never exceed $20,000 in a single week.
2. Headlines must never claim medical benefits, guarantees or total silence.
3. Agents must obtain written manager approval before scheduling a launch event.
4. Approval is not needed for internal rehearsals that are not shown to customers.`,
    },
    rules: [
      { key: 'weekly_spend_cap', title: 'Weekly spend cap', requirement: 'Never spend more than $20,000 in a single week.', type: 'prohibition', quote: 'Weekly paid media spend must never exceed $20,000 in a single week.', evidence: ['weekly spend report'] },
      { key: 'no_unsubstantiated_claims', title: 'No unsubstantiated claims', requirement: 'Headlines never claim medical benefits, guarantees or total silence.', type: 'prohibition', quote: 'Headlines must never claim medical benefits, guarantees or total silence.' },
      {
        key: 'event_approval',
        title: 'Manager approval before scheduling',
        requirement: 'Obtain written manager approval before scheduling a launch event.',
        type: 'obligation',
        quote: 'Agents must obtain written manager approval before scheduling a launch event.',
        applies: { universal: false, actors: ['agent'], actions: ['schedule launch event'] },
        exceptions: ['Approval is not needed for internal rehearsals that are not shown to customers.'],
        evidence: ['approval record'],
      },
    ],
    change: { rule: 'no_unsubstantiated_claims', requirement: 'Also avoid the words "silent" and "noise-free" in this task.', reason: 'Clarifies the claim limit for this creative brief.' },
    conflict: { key: 'weekly_spend_cap', title: 'Weekly spend cap (regional sheet)', requirement: 'Never spend more than $25,000 in a single week.', type: 'prohibition', quote: 'Regional sheet: weekly spend may reach $25,000.' },
  },
  {
    workflow: 'Omnichannel Creative & Locale Compliance',
    name: `${SEED_PREFIX}Omnichannel creative and locale compliance`,
    document: {
      title: 'Creative and locale guidelines (fictional)',
      text: `${header('Creative and locale guidelines')}
1. Every localised creative must use the approved glossary for its locale.
2. Prices must be shown in the local currency of the market.
3. Creatives for the German market must include the legal imprint link.`,
    },
    rules: [
      { key: 'approved_glossary', title: 'Approved glossary', requirement: 'Use the approved glossary for the locale.', type: 'obligation', quote: 'Every localised creative must use the approved glossary for its locale.' },
      { key: 'local_currency', title: 'Local currency', requirement: 'Show prices in the local currency of the market.', type: 'obligation', quote: 'Prices must be shown in the local currency of the market.' },
      { key: 'de_imprint', title: 'German imprint link', requirement: 'Include the legal imprint link on German creatives.', type: 'obligation', quote: 'Creatives for the German market must include the legal imprint link.', applies: { universal: false, locales: ['de-DE'] } },
    ],
    change: { rule: 'local_currency', requirement: 'Show the currency symbol before the amount for this task.', reason: 'Stricter house style for this campaign.' },
  },
  {
    workflow: 'KYB and beneficial ownership',
    name: `${SEED_PREFIX}KYB and beneficial ownership`,
    document: {
      title: 'KYB review standard (fictional)',
      text: `${header('KYB review standard')}
1. The agent recommends a decision; it must never auto-approve a customer.
2. Rationales must never quote identity document numbers or dates of birth.
3. Every beneficial owner holding 25% or more must be identified.`,
    },
    rules: [
      { key: 'no_auto_approval', title: 'No auto-approval', requirement: 'The agent recommends; it never auto-approves a customer.', type: 'prohibition', quote: 'The agent recommends a decision; it must never auto-approve a customer.' },
      { key: 'no_identity_numbers', title: 'No identity numbers', requirement: 'Rationales never quote identity document numbers or dates of birth.', type: 'prohibition', quote: 'Rationales must never quote identity document numbers or dates of birth.' },
      { key: 'ubo_25', title: 'Identify 25% owners', requirement: 'Identify every beneficial owner holding 25% or more.', type: 'obligation', quote: 'Every beneficial owner holding 25% or more must be identified.', visibility: 'evaluator_only' },
    ],
    change: { rule: 'ubo_25', requirement: 'Name the ownership chain for each owner found.', reason: 'Clarifies the expected evidence.' },
  },
  {
    workflow: 'AML transaction-monitoring alerts',
    name: `${SEED_PREFIX}AML transaction-monitoring alerts`,
    document: {
      title: 'Alert handling procedure (fictional)',
      text: `${header('Alert handling procedure')}
1. Customer messages must never mention suspicion, investigations or reports.
2. Exiting a customer is a human decision; the agent must never do it.
3. Every alert disposition must state the reason in plain language.`,
    },
    rules: [
      { key: 'no_tipping_off', title: 'No tipping-off', requirement: 'Customer messages never mention suspicion, investigations or reports.', type: 'prohibition', quote: 'Customer messages must never mention suspicion, investigations or reports.' },
      { key: 'no_customer_exit', title: 'No customer exit by the agent', requirement: 'Exiting a customer is a human decision; the agent never does it.', type: 'prohibition', quote: 'Exiting a customer is a human decision; the agent must never do it.' },
      { key: 'disposition_reason', title: 'Disposition reason', requirement: 'State the reason for every alert disposition in plain language.', type: 'obligation', quote: 'Every alert disposition must state the reason in plain language.' },
    ],
    change: { rule: 'disposition_reason', requirement: 'Keep the reason under 80 words.', reason: 'Clarifies length for this task.' },
  },
  {
    workflow: 'KYC onboarding and refresh',
    name: `${SEED_PREFIX}KYC onboarding and refresh`,
    document: {
      title: 'KYC onboarding checklist (fictional)',
      text: `${header('KYC onboarding checklist')}
1. Proof of address must be dated within the last three months.
2. Sanctions screening must be completed before the account is opened.
3. A refresh review is required every 12 months for high-risk customers.`,
    },
    rules: [
      { key: 'address_recency', title: 'Recent proof of address', requirement: 'Proof of address is dated within the last three months.', type: 'obligation', quote: 'Proof of address must be dated within the last three months.' },
      { key: 'screen_before_open', title: 'Screen before opening', requirement: 'Complete sanctions screening before opening the account.', type: 'obligation', quote: 'Sanctions screening must be completed before the account is opened.' },
      { key: 'high_risk_refresh', title: 'Annual high-risk refresh', requirement: 'Review high-risk customers every 12 months.', type: 'obligation', quote: 'A refresh review is required every 12 months for high-risk customers.', applies: { universal: false, entities: ['high-risk customer'] } },
    ],
    change: { rule: 'address_recency', requirement: 'Utility bills only; no bank statements.', reason: 'Stricter evidence for this task.' },
  },
];

function candidate(r: SeedRule): CandidateRule {
  return {
    ruleKey: r.key,
    title: r.title,
    requirement: r.requirement,
    requirementType: r.type,
    visibility: r.visibility ?? 'agent_visible',
    applicability: { universal: true, actors: [], actions: [], entities: [], channels: [], locales: [], jurisdictions: [], conditionText: null, ...r.applies },
    prerequisites: [],
    precedence: [],
    exceptions: r.exceptions ? { kind: 'listed', items: r.exceptions.map((statement) => ({ statement, conditions: null })) } : { kind: 'none', items: [] },
    effective: { from: null, to: null, conditionText: 'always' },
    evidenceNeeds: r.evidence ?? [],
    verificationHint: null,
    uncertainty: [],
    citations: [
      { fieldPath: 'requirement', role: 'supports', quote: r.quote, page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: null },
      ...(r.exceptions ?? []).map((q) => ({ fieldPath: 'exceptions', role: 'exception' as const, quote: q, page: null, chunkId: null, lineStart: null, lineEnd: null, confidence: null })),
    ],
  };
}

export interface PolicySeedResult {
  created: string[];
  skipped: string[];
  missingTemplates: string[];
}

export async function policySeed(db: Db, deps: { storage: ObjectStorage; appEnv: string; clientId: string; ownerId: string }, log: (level: string, message: string, extra?: object) => void = () => undefined): Promise<PolicySeedResult> {
  if (deps.appEnv === 'production') throw new Error('policy-seed refuses to run in production');
  const out: PolicySeedResult = { created: [], skipped: [], missingTemplates: [] };
  for (const sp of SEED_PROJECTS) {
    const template = await db.template.findFirst({ where: { clientId: deps.clientId, workflowName: sp.workflow, status: { not: 'RETIRED' } }, orderBy: { version: 'desc' } });
    if (!template) {
      out.missingTemplates.push(sp.workflow);
      log('warning', 'policy seed: template missing, project skipped', { workflow: sp.workflow });
      continue;
    }
    const done = await db.$transaction(async (tx) => seedProject(tx, deps, sp, template), { timeout: 60_000 });
    (done ? out.created : out.skipped).push(sp.name);
  }
  log('info', 'policy seed', { ...out });
  return out;
}

async function seedProject(tx: Tx, deps: { storage: ObjectStorage; clientId: string; ownerId: string }, sp: SeedProject, template: { id: string; version: number }) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'policy-seed:' + deps.clientId + ':' + sp.name}))`;
  if (await tx.project.findFirst({ where: { clientId: deps.clientId, name: sp.name } })) return false;
  const audit = (a: AuditInput) => writeAudit(tx, { clientId: deps.clientId, actorType: 'SYSTEM', actorId: SEED_ACTOR }, a);
  const project = await tx.project.create({ data: { clientId: deps.clientId, ownerId: deps.ownerId, templateId: template.id, templateVersion: template.version, name: sp.name } });
  await audit({ entityType: 'Project', entityId: project.id, action: 'policy.seed_project_created', after: { name: sp.name, fixture: true } });

  const base = { clientId: deps.clientId, projectId: project.id, actorId: SEED_ACTOR };
  const doc = await addDocumentVersion(
    tx,
    { storage: deps.storage, scanner: stubScanner, maxPages: 20 },
    { ...base, meta: { title: sp.document.title, category: 'SEED fixture' }, fileName: 'seed-policy.md', buf: Buffer.from(sp.document.text, 'utf8'), origin: 'SEED' },
    audit,
  );
  const text = await loadVersionText(deps.storage, doc.version);
  const docRef = { ...text, format: doc.version.format };

  const versions = new Map<string, string>();
  for (const r of sp.rules) {
    const made = await createRuleFromCandidate(tx, { ...base, documentVersion: doc.version, doc: docRef, candidate: candidate(r), origin: 'seed', editedById: SEED_ACTOR, ruleKey: r.key });
    await markReviewed(tx, { ...base, ruleVersionId: made.version.id, expectedContentHash: made.version.contentHash, required: true }, audit);
    versions.set(r.key, made.version.id);
  }
  await publishRuleSet(tx, { ...base, expectedLatestVersion: null }, audit);

  // Left as a Draft after publication: visible in Review Rules as a conflict that blocks the next publication.
  if (sp.conflict) {
    const extra = await addDocumentVersion(
      tx,
      { storage: deps.storage, scanner: stubScanner, maxPages: 20 },
      { ...base, meta: { title: 'Regional media sheet (fictional)', category: 'SEED fixture' }, fileName: 'seed-regional.md', buf: Buffer.from(`${header('Regional media sheet')}\n${sp.conflict.quote}`, 'utf8'), origin: 'SEED' },
      audit,
    );
    const t2 = await loadVersionText(deps.storage, extra.version);
    await createRuleFromCandidate(tx, { ...base, documentVersion: extra.version, doc: { ...t2, format: extra.version.format }, candidate: candidate(sp.conflict), origin: 'seed', editedById: SEED_ACTOR, ruleKey: sp.conflict.key });
  }

  for (const n of [1, 2]) {
    const task = await tx.taskInstance.create({ data: { clientId: deps.clientId, projectId: project.id, taskType: 'AUTHORING', input: { slot: { brief: `SEED fixture draft ${n} — fictional`, isOpen: false } } } });
    if (n === 1) {
      await addChange(tx, { ...base, taskId: task.id, change: { ruleVersionId: versions.get(sp.change.rule)!, type: 'CLARIFICATION', requirement: sp.change.requirement, scope: {}, reason: sp.change.reason, sourceCitationId: null, exceptionIndex: null } }, audit);
    }
    await snapshotTask(tx, { clientId: deps.clientId, task, actorId: SEED_ACTOR });
  }
  return true;
}
