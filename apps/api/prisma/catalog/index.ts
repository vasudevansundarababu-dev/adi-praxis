import { HarborBlueprint, type TaskMode } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Meta-Compiler catalog (PRD D15, D15a; architecture §11). Exactly the mockup catalog: Digital Marketing (3)
 * and Banking (11; Control testing and Country-specific interpretation were removed by the owner on 10 Nov 2026;
 * KYC onboarding and refresh was kept in the catalog by the owner on 10 Nov 2026).
 * Every seeded workflow is published: three carry a full synthetic `blueprint` file, the rest carry the owner's
 * publish `fields`. Everything else from the old Taskflow catalog is retired by `catalog-v2`.
 */

/** The publish fields (`publishProblems`) the owner supplied for a workflow without a blueprint (D15, 10 Nov 2026). */
export interface CatalogWorkflowFields {
  primaryWork: string;
  verificationCriteria: string;
  humanGate: string;
  skills: string[];
  taskModes: TaskMode[];
  defaultTptMinutes: number;
}

export interface CatalogWorkflow {
  workflowName: string;
  /** JSON file in this folder with the full blueprint (S1-17), or null when the workflow is seeded from `fields`. */
  blueprint: string | null;
  /** Publish fields for a workflow without a blueprint. */
  fields?: CatalogWorkflowFields;
}

export interface CatalogDomain {
  name: string;
  workflows: CatalogWorkflow[];
}

export const CATALOG_V2: CatalogDomain[] = [
  {
    name: 'Digital Marketing',
    workflows: [
      { workflowName: 'Launch of Noise Cancelling Phone', blueprint: 'launch-of-noise-cancelling-phone.json' },
      {
        workflowName: 'Q4 Global Paid Search Query Clustering',
        blueprint: null,
        fields: {
          primaryWork: 'Real world Campaign Tasks Authoring',
          verificationCriteria:
            "Query intent labels and cluster assignments match the SME's oracle (F1 >= 0.99); every query is labelled once; clusters follow the brief's naming and coverage rules.",
          humanGate: "A Reviewer checks the SME's oracle labels and the cluster assignment before approval; the agent only recommends.",
          skills: ['Digital Marketer with Product Launch Experience in Consumer Electronics'],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 30,
        },
      },
      {
        workflowName: 'Omnichannel Creative & Locale Compliance',
        blueprint: null,
        fields: {
          primaryWork: 'Author realistic marketing Tasks, campaign briefs, creative examples, reference answers and scoring rubrics across channels and locales.',
          verificationCriteria:
            'Check brief clarity, channel requirements, language accuracy, cultural suitability, brand consistency, applicable advertising rules and measurable scoring criteria.',
          humanGate:
            'A qualified marketing reviewer approves the Task before publication, with locale or compliance specialist review where needed, recording the decision and required changes.',
          skills: [
            'Digital marketing',
            'omnichannel creative development',
            'localisation',
            'cultural sensitivity',
            'advertising-policy compliance',
            'brand-guideline interpretation',
            'Task and rubric authoring',
          ],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 30,
        },
      },
    ],
  },
  {
    name: 'Banking',
    workflows: [
      {
        workflowName: 'Adverse media review',
        blueprint: null,
        fields: {
          primaryWork:
            'Yes. Their primary work is to author realistic banking Tasks, supporting evidence, reference answers and scoring rubrics. Their KYC/KYB, AML and adverse-media expertise ensures those materials are accurate and assessable.',
          verificationCriteria:
            'Check that the Task is clear, policies are correctly cited, evidence supports the reference answer, and the rubric scores valid responses fairly',
          humanGate: 'A separate qualified reviewer approves, requests changes or rejects the Task before publication, recording their decision and reasons.',
          skills: [
            'KYC/KYB investigation',
            'AML investigation',
            'adverse-media assessment',
            'identity and beneficial-ownership verification',
            'applicable US or India regulatory knowledge',
            'evidence-based decision-making and escalation',
            'policy citation and interpretation',
            'task and rubric authoring',
            'clear case writing',
            'confidential data handling',
          ],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 60,
        },
      },
      { workflowName: 'AML transaction-monitoring alerts', blueprint: 'aml-transaction-monitoring-alerts.json' },
      {
        workflowName: 'Audit and evidence preparation',
        blueprint: null,
        fields: {
          primaryWork: 'Author realistic audit-preparation Tasks, supporting evidence packs, reference answers and scoring rubrics.',
          verificationCriteria:
            'Check that audit scope is clear, evidence is traceable, policy references are accurate, gaps are identified and rubric criteria are measurable.',
          humanGate:
            'A separate qualified banking audit reviewer approves, requests changes or rejects the Task before publication, recording the decision and reasons.',
          skills: ['Banking audit', 'internal controls', 'evidence assessment', 'regulatory-policy interpretation', 'audit documentation', 'Task and rubric authoring', 'confidential data handling'],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 60,
        },
      },
      {
        workflowName: 'Communications surveillance',
        blueprint: null,
        fields: {
          primaryWork:
            'Author realistic communications-review Tasks, synthetic message records, reference assessments and scoring rubrics for identifying and escalating potential misconduct.',
          verificationCriteria:
            'Check that scenarios are realistic, communications preserve context, policy references are accurate, escalation decisions are evidence-based and rubric criteria distinguish suspicious conduct from legitimate activity.',
          humanGate:
            'A separate qualified surveillance or compliance reviewer approves, requests changes or rejects the Task before publication, recording the decision and reasons.',
          skills: ['Banking communications surveillance', 'market-conduct risk', 'compliance-policy interpretation', 'evidence assessment', 'Task and rubric authoring', 'confidential data handling'],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 60,
        },
      },
      {
        workflowName: 'Compliance monitoring',
        blueprint: null,
        fields: {
          primaryWork:
            'Author realistic compliance-monitoring Tasks, supporting records, reference assessments and scoring rubrics for identifying control gaps and recommending corrective actions.',
          verificationCriteria:
            'Check that obligations and monitoring scope are clear, evidence supports findings, policy references are accurate and rubric criteria distinguish compliant, non-compliant and insufficient-evidence outcomes.',
          humanGate:
            'A separate qualified banking compliance reviewer approves, requests changes or rejects the Task before publication, recording the decision and reasons.',
          skills: ['Banking compliance monitoring', 'regulatory-policy interpretation', 'control assessment', 'evidence analysis', 'Task and rubric authoring', 'confidential data handling'],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 60,
        },
      },
      {
        workflowName: 'Customer risk rating',
        blueprint: null,
        fields: {
          primaryWork: 'Author realistic customer-risk-rating Tasks, supporting profiles and evidence, reference ratings and scoring rubrics.',
          verificationCriteria:
            'Check that risk factors and rating methodology are explicit, evidence supports the rating, policy thresholds and exceptions are applied correctly, and rubric criteria handle missing information and justified alternative conclusions.',
          humanGate: 'A separate qualified KYC/AML reviewer approves, requests changes or rejects the Task before publication, recording the decision and reasons.',
          skills: ['KYC/KYB assessment', 'customer risk profiling', 'AML risk factors', 'policy interpretation', 'evidence analysis', 'Task and rubric authoring', 'confidential data handling'],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 60,
        },
      },
      {
        workflowName: 'Enhanced due diligence',
        blueprint: null,
        fields: {
          primaryWork:
            'Author realistic enhanced-due-diligence Tasks, supporting evidence packs, reference assessments and scoring rubrics for investigating higher-risk customer relationships.',
          verificationCriteria:
            'Check that review triggers and scope are clear, ownership and funding evidence support conclusions, policy requirements are correctly applied, and rubric criteria address missing evidence, escalation and justified alternative decisions.',
          humanGate: 'A separate qualified EDD/AML reviewer approves, requests changes or rejects the Task before publication, recording the decision and reasons.',
          skills: [
            'Enhanced due diligence',
            'KYC/KYB investigation',
            'beneficial-ownership analysis',
            'source-of-funds and source-of-wealth assessment',
            'policy interpretation',
            'Task and rubric authoring',
            'confidential data handling',
          ],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 60,
        },
      },
      {
        workflowName: 'Fraud-risk/compliance handoffs',
        blueprint: null,
        fields: {
          primaryWork:
            'Author realistic fraud-to-compliance handoff Tasks, case evidence, reference handoff reports and scoring rubrics covering ownership, urgency and next actions.',
          verificationCriteria:
            'Check that fraud indicators are evidence-based, facts and suspicions are distinguished, escalation routes and responsibilities are clear, and rubrics assess completeness, timeliness and appropriate information sharing.',
          humanGate:
            'A separate qualified fraud/compliance reviewer approves, requests changes or rejects the Task before publication, recording the decision and reasons.',
          skills: ['Fraud investigation', 'AML/compliance assessment', 'case triage and escalation', 'evidence documentation', 'Task and rubric authoring', 'confidential data handling'],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 60,
        },
      },
      {
        workflowName: 'Issue and remediation tracking',
        blueprint: null,
        fields: {
          primaryWork:
            'Author realistic issue-tracking Tasks, supporting records, reference remediation plans and scoring rubrics covering ownership, deadlines, progress and closure.',
          verificationCriteria:
            'Check that issues and root causes are evidence-based, actions address identified gaps, owners and deadlines are clear, and closure requires adequate evidence and validation.',
          humanGate:
            'A separate qualified banking risk or compliance reviewer approves, requests changes or rejects the Task before publication, recording the decision and reason',
          skills: ['Banking issue management', 'remediation planning', 'root-cause analysis', 'control assessment', 'evidence documentation', 'Task and rubric authoring', 'confidential data handling'],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 60,
        },
      },
      { workflowName: 'KYB and beneficial ownership', blueprint: 'kyb-and-beneficial-ownership.json' },
      // Owner decision (10 Nov 2026): KYC onboarding and refresh stays in the catalog (authoring v2.1 Wave 1 template),
      // so catalog-v2 never retires it. It keeps its own task definition (docs/TASK-KYC.md); these are its publish fields.
      {
        workflowName: 'KYC onboarding and refresh',
        blueprint: null,
        fields: {
          primaryWork: 'Author realistic, fully synthetic KYC onboarding and periodic-refresh cases with their evidence, recorded tool responses, reference disposition and risk rating, and a scoring rubric.',
          verificationCriteria:
            'Check that identity, address and ownership evidence is internally consistent or deliberately flawed as stated, every step and finding cites evidence, the disposition and risk rating follow the stated policy, and rubric criteria are testable against the trajectory or outcome.',
          humanGate: 'A separate qualified KYC reviewer approves, requests changes or rejects the Task before publication, recording the decision and reasons.',
          skills: ['KYC', 'EDD', 'identity and document verification', 'sanctions and PEP screening', 'customer risk rating', 'Task and rubric authoring', 'confidential data handling'],
          taskModes: ['AUTHORING'],
          defaultTptMinutes: 90,
        },
      },
    ],
  },
];

/** Old-catalog domains retired as a whole (D15a). Banking workflows not in CATALOG_V2 are retired one by one. */
export const RETIRED_DOMAINS = ['Healthcare', 'Marketing', 'Research Assistant'] as const;

/** Name match used to reuse existing lineages: case, spacing and dash style are ignored (en dash = hyphen). */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function loadCatalogBlueprint(file: string): HarborBlueprint {
  return HarborBlueprint.parse(JSON.parse(readFileSync(path.join(import.meta.dirname, file), 'utf8')));
}

/** The full blueprints, with their domain and workflow name. */
export function catalogBlueprints(): { domain: string; workflowName: string; file: string; blueprint: HarborBlueprint }[] {
  return CATALOG_V2.flatMap((d) =>
    d.workflows.filter((w) => w.blueprint).map((w) => ({ domain: d.name, workflowName: w.workflowName, file: w.blueprint!, blueprint: loadCatalogBlueprint(w.blueprint!) })),
  );
}
