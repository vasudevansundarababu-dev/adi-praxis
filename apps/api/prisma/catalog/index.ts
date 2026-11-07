import { HarborBlueprint } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Meta-Compiler catalog (PRD D15, D15a; architecture §11). Exactly the mockup catalog: Digital Marketing (3)
 * and Banking (12). Workflows with a `blueprint` file are seeded with a full synthetic blueprint and published;
 * the others are seeded as drafts. Everything else from the old Taskflow catalog is retired by `catalog-v2`.
 */

export interface CatalogWorkflow {
  workflowName: string;
  /** JSON file in this folder with the full blueprint (S1-17), or null for a draft without one. */
  blueprint: string | null;
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
      { workflowName: 'Q4 Global Paid Search Query Clustering', blueprint: null },
      { workflowName: 'Omnichannel Creative & Locale Compliance', blueprint: null },
    ],
  },
  {
    name: 'Banking',
    workflows: [
      { workflowName: 'Adverse media review', blueprint: null },
      { workflowName: 'AML transaction-monitoring alerts', blueprint: 'aml-transaction-monitoring-alerts.json' },
      { workflowName: 'Audit and evidence preparation', blueprint: null },
      { workflowName: 'Communications surveillance', blueprint: null },
      { workflowName: 'Compliance monitoring', blueprint: null },
      { workflowName: 'Control testing', blueprint: null },
      { workflowName: 'Country-specific interpretation', blueprint: null },
      { workflowName: 'Customer risk rating', blueprint: null },
      { workflowName: 'Enhanced due diligence', blueprint: null },
      { workflowName: 'Fraud-risk/compliance handoffs', blueprint: null },
      { workflowName: 'Issue and remediation tracking', blueprint: null },
      { workflowName: 'KYB and beneficial ownership', blueprint: 'kyb-and-beneficial-ownership.json' },
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
