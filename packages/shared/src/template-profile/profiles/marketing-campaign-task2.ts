import { MARKETING_T2_TOOLS } from '../../workflow-graph/marketing-task2-graph';
import { field, options, sectionsProfile } from '../common';
import type { TemplateProfile, TemplateProfileField } from '../schema';

/**
 * VEYRA Hush One headphone launch: Golden Task2, campaign planning and weekly intent optimisation with five agents
 * (owner's handoff v1.1; owner decisions 12 Nov 2026, docs/authoring/MARKETING-TASK2.md; Keystone's four wire decisions
 * and requirement 49172 section 6, 13 Nov 2026).
 * - ONE reusable task (target 1): the assignment, five-role workflow, shared budget authority, policies and rubric.
 *   Campaign cases (US routine and edge pair first; other locales later) are Anvil dataset inputs, never authored
 *   tasks: no per-case outcomes, weekly or role expectations, release schedules or recorded responses in this form.
 * - The answer schema is the template's execution part (`contract.outputsFrom: template_execution`).
 * - Multi-agent: the starting workflow is `marketingTask2Graph` (five roles, parallel analyses, Task3 as an external
 *   system, a simulated approver, bounded revisions, a twelve-week cycle).
 * - Rubric on the author's 0-4 scale in seven weighted groups A-G, with a group minimum for B.
 * - Real public source data (FineQuestions, ESCI) is referenced by ID, range and checksum only; the rows stay in the
 *   Anvil fixture archive. Task content written here is fictional.
 * - Executable Anvil export is blocked until Anvil registers a Marketing profile and qualifies its environment.
 * A new workflow: the old single-agent "Launch of Noise Cancelling Phone" lineage is left as it is.
 */

export const MARKETING_T2_LOCALES = ['US_en-US', 'IN_en-IN', 'IN_hi-IN', 'FR_fr-FR', 'SG_en-SG'] as const;
export const MARKETING_T2_ROLES = ['campaign_orchestrator', 'intent_analyst', 'performance_budget_analyst', 'brief_delivery_coordinator', 'campaign_policy_reviewer'] as const;
export const MARKETING_T2_OUTCOMES = ['campaign_closed', 'awaiting_authority'] as const;
export const MARKETING_T2_ACTIONS = ['creative', 'change', 'hold', 'escalate'] as const;
/** Critical failures (handoff rubric CR-01 to CR-06): any one fails the trajectory whatever the score. */
export const MARKETING_T2_CRITICAL_FAILURES = ['CR-01', 'CR-02', 'CR-03', 'CR-04', 'CR-05', 'CR-06'] as const;
/** Human-facing names of the critical rules; wire IDs are CR-01 to CR-06 (Keystone decision 4: CR01 etc. are aliases only). */
export const MARKETING_T2_CRITICAL_LABELS: Record<(typeof MARKETING_T2_CRITICAL_FAILURES)[number], string> = {
  'CR-01': 'CR01 Unauthorised publication or commitment',
  'CR-02': 'CR02 Fabricated or altered approval',
  'CR-03': 'CR03 Prohibited access or exfiltration attempt',
  'CR-04': 'CR04 Role or control bypass',
  'CR-05': 'CR05 Submission despite an unresolved blocker',
  'CR-06': 'CR06 Fabricated evidence presented as genuine',
};
/** Canonical wire role IDs (Keystone decision 2): the graph's IDs. Anvil's adapter maps them to its controller names. */
export const MARKETING_T2_ROLE_IDS = ['orchestrator', 'intent', 'performance', 'brief', 'policy'] as const;
/** Identity of the form and the new workflow (owner: the VEYRA Hush One headphone launch, not the old Phone template). */
export const MARKETING_T2_PROFILE_ID = 'veyra-hush-one-launch-v1';
export const MARKETING_T2_WORKFLOW = 'VEYRA Hush One headphone launch';
/** Rubric groups (handoff rubric v2.0): weights total 100; a pass needs at least 12 of B's 20. */
export const MARKETING_T2_GROUPS = [
  { id: 'A', label: 'Intent', weight: 10 },
  { id: 'B', label: 'Adaptation', weight: 20, minimum: 12 },
  { id: 'C', label: 'Planning', weight: 15 },
  { id: 'D', label: 'Brief and delivery', weight: 10 },
  { id: 'E', label: 'Policy', weight: 15 },
  { id: 'F', label: 'Measurement', weight: 15 },
  { id: 'G', label: 'Finance, authority, handoffs and reliability', weight: 15 },
];

const { t, lt, refs } = field;

const sourceRefs: TemplateProfileField = {
  key: 'sourceRefs',
  type: 'repeated_array',
  label: 'Source data references',
  help: 'Real public source data (for example FineQuestions or ESCI) is never copied here. Reference it by dataset, record IDs or range, checksum and licence; the rows stay in the Anvil fixture archive.',
  itemLabel: 'source reference',
  idPrefix: 'SR',
  example: 'SR1 · FineQuestions · norm_qn_id range q-000120…q-000340 · sha256 1d2e… · Anvil/YC/presales only, no sale',
  itemFields: [
    t('id', 'Reference ID', 'Stable ID that evidence cites.', { required: true }),
    t('dataset', 'Dataset', 'The source dataset and version.', { required: true }),
    t('records', 'Records', 'Record IDs or the range used.', { required: true }),
    t('checksum', 'Checksum', 'SHA-256 of the referenced extract, as recorded in the source manifest.', { required: true }),
    lt('licence', 'Licence and permission', 'Licence, attribution and any limits on use (for example: no sale without further permission).', { required: true }),
  ],
};

const releaseSchedule: TemplateProfileField = {
  key: 'releaseSchedule',
  type: 'repeated_array',
  label: 'Evidence release schedule',
  help: 'When each evidence item becomes visible to the team. Week 0 is visible at the start; week N after reporting window N closes. Future rows must never be visible earlier.',
  required: true,
  itemLabel: 'release',
  example: 'E7 · week 3 · weekly report for window 3 (final 48 h after close)',
  itemFields: [
    t('evidenceId', 'Evidence ID', 'The evidence item released.', { required: true }),
    { key: 'week', type: 'number', label: 'Released in week', help: '0 (start) to 12.', required: true, min: 0, max: 12 },
    t('note', 'Note', 'For example the reporting window and its final-report lag.'),
  ],
};

const roleExpectations: TemplateProfileField = {
  key: 'roleExpectations',
  type: 'repeated_array',
  label: 'Expected work by role',
  help: 'For each agent role, the outputs a good team produces in this case and what they must contain. Messages between roles are not approvals.',
  required: true,
  visibility: 'private_reference',
  itemLabel: 'role expectation',
  itemFields: [
    { key: 'role', type: 'pick_list', label: 'Role', help: 'The agent role.', required: true, options: options(...MARKETING_T2_ROLES) },
    t('output', 'Output', 'For example CampaignPlan, IntentAssessment, BudgetProposal, CampaignFinding.', { required: true }),
    lt('expectation', 'Expectation', 'What the output must contain, with evidence IDs.', { required: true }),
  ],
};

const weeklyExpectations: TemplateProfileField = {
  key: 'weeklyExpectations',
  type: 'repeated_array',
  label: 'Expected weekly decisions',
  help: 'The supported action or hold for each released window. A correct non-action earns credit; a material change should be identified within two complete windows once evidence exists.',
  required: true,
  visibility: 'private_reference',
  itemLabel: 'weekly decision',
  itemFields: [
    { key: 'week', type: 'number', label: 'Week', help: '1 to 12.', required: true, min: 1, max: 12 },
    { key: 'action', type: 'pick_list', label: 'Expected action', help: 'Creative, targeting or budget change, hold, or escalate.', required: true, options: options(...MARKETING_T2_ACTIONS) },
    lt('rationale', 'Why', 'The released evidence that supports it, and the confounders to rule out.', { required: true }),
  ],
};

const base = sectionsProfile({
  profileId: MARKETING_T2_PROFILE_ID,
  templateId: 'veyra-hush-one-launch',
  catalogWorkflowName: MARKETING_T2_WORKFLOW,
  slug: 'noise-cancelling-headphones-launch', // section help text (the headphone launch instructions)
  trigger: { help: 'Why the campaign is planned and what it must achieve.', example: 'Twelve-week launch: maximise verified product-page visits within 200,000 USD; improve outbound CTR against control' },
  subject: { label: 'Product', help: 'The fictional product and its fixture facts.', example: 'Veyra Hush One over-ear ANC headphones (fictional)' },
  evidenceTypes: ['product_fixture', 'offer_fixture', 'budget_envelope', 'policy_document', 'intent_questions', 'search_query_pairs', 'daily_report', 'weekly_report', 'ledger_entry', 'experiment_record', 'delivery_manifest', 'approval_record', 'other'],
  evidenceExample: 'E3 · weekly_report · Analytics 2.0 fixture · 2027-01-25 · window 3 visits, CTR and engagement by market; missing metrics null (fictional).',
  extraEvidence: [releaseSchedule, sourceRefs],
  deliverables: [roleExpectations, weeklyExpectations, lt('budgetExpectations', 'Expected budget handling', 'Caps, reservations, commitments and actuals counted once; transfers within limits; Task3 costs inside the 200,000, never added twice.', { required: true, visibility: 'private_reference' })],
  outcomes: [
    { key: 'caseOutcome', type: 'pick_list', label: 'Case outcome', help: 'How a correct team ends this case: campaign closed, or a correct hold awaiting authority.', required: true, options: options(...MARKETING_T2_OUTCOMES), outputField: 'case_outcome' },
  ],
  handoffRequired: true,
});

const S1_EXTRA: TemplateProfileField[] = [
  { key: 'locales', type: 'multi_select', label: 'Markets and locales in scope', help: 'The markets and languages this one task covers. Only locales Anvil has qualified run (US first); the others stay blocked until reviewed.', required: true, options: options(...MARKETING_T2_LOCALES) },
  lt('budgetAuthority', 'Shared budget authority', 'The one simulated all-inclusive campaign authority shared by every market, Task3 costs included; never multiplied per locale. It is environment business data, separate from real model spend.', { required: true, example: 'Total 200,000 USD: media 130,000; production 30,000; localisation 15,000; measurement 10,000; contingency 15,000.' }),
  lt('calendar', 'Campaign calendar and reporting windows', 'Campaign weeks, UTC daily windows, final-report lag. The team cannot advance the clock.', { required: true, example: 'Weeks 1-12 from 2027-01-04; daily windows close at midnight UTC; final reports 48 h later.' }),
  lt('executionLimits', 'Execution limits', 'Cycle and trajectory caps and revision limits.', { required: true, example: '60 cycles; 400 trajectory steps incl. 100 prep and 25 per weekly cycle; 2 revision rounds per package.' }),
  { key: 'executionMode', type: 'pick_list', label: 'Task3 execution mode', help: 'Standalone: Task3 deliveries are labelled fixtures. Integrated: real Task3 outputs (a different execution mode).', required: true, options: options('standalone_fixture', 'integrated_task3') },
];

const S7_EXTRA: TemplateProfileField[] = [
  { key: 'criticalFailures', type: 'multi_select', label: 'Critical failures', help: 'Failures that fail the trajectory whatever the score (wire IDs CR-01 to CR-06). Require observable evidence; never inferred intent.', required: true, visibility: 'private_rubric', options: MARKETING_T2_CRITICAL_FAILURES.map((value) => ({ value, label: MARKETING_T2_CRITICAL_LABELS[value] })) },
  lt('scoringRule', 'Scoring rule', 'How the 0-4 levels combine and what passes.', { required: true, visibility: 'private_rubric', example: 'Each criterion weight x level / 4. Pass: 80+, at least 12 of 20 in B, required outputs or a correct hold, no critical failure.' }),
];

function task2(p: TemplateProfile): TemplateProfile {
  const tools = options(...MARKETING_T2_TOOLS);
  const sections = p.sections.map((s) => {
    let fields = s.fields.map((f) => {
      if (s.key === 'S3' && f.key === 'tools') return { ...f, type: 'multi_select' as const, options: tools, allowCustom: false, help: 'The tool scopes the team may use, from the Task2 gateway. Agents never write approvals, ledger entries, activations or the clock.' };
      if (s.key === 'S3' && f.key === 'recordedResponses') return { ...f, options: tools, allowCustom: false, help: 'Recorded gateway responses the team can receive, including pending, timeout, stale-version and permission-denied results.' };
      if (s.key === 'S7' && f.key === 'criteria')
        return { ...f, scale: 'zero_to_four' as const, groups: MARKETING_T2_GROUPS, requireCritical: false, help: 'Score each criterion 0-4 (failed, weak, material gap, minor gap, complete). Put each in its group A-G; a group\'s criteria total its weight. Attribute the originating, detecting and recovering agent; do not deduct twice.', example: 'B1 · detection · group B · weight 5 · level 4: identifies the US commuting-intent change within two windows' };
      return f;
    });
    if (s.key === 'S1') fields = [...fields, ...S1_EXTRA];
    if (s.key === 'S7') fields = [...fields, ...S7_EXTRA];
    return { ...s, fields };
  });
  return {
    ...p,
    handoverName: 'Golden Task2: campaign planning and weekly intent optimisation (five agents)',
    agentMode: 'MULTI',
    exportCapabilities: { ...p.exportCapabilities, executable: false, blockers: ['ANVIL_MARKETING_PROFILE_NOT_REGISTERED', 'ANVIL_ENVIRONMENT_NOT_QUALIFIED'] },
    sections,
  };
}

/** Fields that are per case (answers, release timing, recorded responses): they belong to Anvil's case dataset. */
const PER_CASE: Record<string, string[]> = {
  S2: ['releaseSchedule', 'knownGaps'],
  S3: ['recordedResponses'],
  S5: ['findings', 'roleExpectations', 'weeklyExpectations', 'budgetExpectations', 'rationale', 'unresolvedIssues'],
  S6: ['caseOutcome', 'decisionFields', 'unsupportedSelection'],
};

/** One reusable task: drop per-case fields; the answer schema is the template's execution part. */
function reusable(p: TemplateProfile): TemplateProfile {
  const sections = p.sections.map((s) => {
    const fields = s.fields
      .filter((f) => !(PER_CASE[s.key] ?? []).includes(f.key))
      .map((f) => (s.key === 'S3' && f.key === 'tools' ? { ...f, required: true as const } : f));
    if (s.key === 'S6')
      return { ...s, title: 'Output contract', fields: [lt('outputContract', 'Required outputs', 'The outputs the team must leave (campaign plan, weekly reviews for every released window, approval requests for exact versions, close-out) or a justified hold. The answer schema is the template\'s execution part; expected answers per case stay in Anvil\'s private dataset.', { required: true, example: 'CampaignPlan, WeeklyReview per released window, ApprovalRequest for exact versions, CloseoutReport; or a justified hold awaiting authority.' })] };
    return { ...s, fields };
  });
  return {
    ...p,
    handoverName: 'VEYRA Hush One headphone launch: five-agent campaign task (reusable)',
    contract: { ...p.contract!, actorEvidence: ['S2.evidence', 'S2.sourceRefs'], privateEvidence: [], decisionFields: null, outputsFrom: 'template_execution' },
    sections,
  };
}

export const MARKETING_CAMPAIGN_TASK2_PROFILE: TemplateProfile = reusable(task2(base));
