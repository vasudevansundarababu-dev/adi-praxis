import type { Prisma, PrismaClient } from '@prisma/client';
import { CoverageDimensions, EdgeCaseCatalog } from '@praxis/shared';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';

/**
 * Imports the template catalog from Taskflow.xlsx, sheet "Task Templates" (SPEC: Admin template catalog).
 *
 * Sheet layout: column A names a domain on the row where its group starts (and is blank below it);
 * columns B–E are Workflow, Primary agent work, Verification / reward, Human gate. The header row shares
 * its row with the first domain ("Banking"). Name-only rows have blank C–E.
 *
 * Rules (SPEC + decisions of 26 Sep 2026):
 * - every row is imported; the three Banking description columns are kept verbatim;
 * - every template is created as DRAFT (an Admin completes and publishes it);
 * - "KYC onboarding and refresh" is pre-filled with SPEC's example coverage dimensions and edge-case catalog;
 * - re-running never duplicates a workflow and never overwrites an Admin's edits.
 */

export const TASKFLOW_SHEET = 'Task Templates';
const EXPECTED_HEADERS = ['Workflow', 'Primary agent work', 'Verification / reward', 'Human gate'];

/** Domain names in the sheet that differ from SPEC's catalog; SPEC's spelling wins. */
const DOMAIN_NAME_FIXES: Record<string, string> = { 'Researh Assistant': 'Research Assistant' };

export interface TaskflowRow {
  domain: string;
  workflowName: string;
  primaryWork: string | null;
  verificationCriteria: string | null;
  humanGate: string | null;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return String(v.result ?? '');
  }
  return String(v);
}

export async function readTaskflow(path: string): Promise<TaskflowRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet(TASKFLOW_SHEET);
  if (!ws) throw new Error(`Sheet "${TASKFLOW_SHEET}" not found in ${path}`);

  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    rows.push([1, 2, 3, 4, 5].map((c) => cellText(row.getCell(c).value)));
  });
  return parseTaskflowRows(rows);
}

/** Pure parser over the sheet's first five columns. */
export function parseTaskflowRows(rows: string[][]): TaskflowRow[] {
  const out: TaskflowRow[] = [];
  let domain: string | null = null;
  let sawHeader = false;

  for (const raw of rows) {
    const [a, b, c, d, e] = raw.map((v) => v ?? '');
    if (a!.trim()) domain = DOMAIN_NAME_FIXES[a!.trim()] ?? a!.trim();

    if (b!.trim() === 'Workflow') {
      const headers = [b, c, d, e].map((h) => h!.trim());
      if (headers.join('|') !== EXPECTED_HEADERS.join('|')) {
        throw new Error(`Unexpected Taskflow headers: ${headers.join(', ')} (expected ${EXPECTED_HEADERS.join(', ')})`);
      }
      sawHeader = true;
      continue;
    }
    if (!b!.trim()) continue;
    if (!sawHeader) throw new Error('Taskflow header row (Workflow, Primary agent work, …) not found before data');
    if (!domain) throw new Error(`Workflow "${b}" has no domain above it`);

    // Descriptions are kept verbatim; only blank cells become null.
    const keep = (s: string) => (s.trim() ? s : null);
    out.push({
      domain,
      workflowName: b!.trim(),
      primaryWork: keep(c!),
      verificationCriteria: keep(d!),
      humanGate: keep(e!),
    });
  }
  return out;
}

/** SPEC "Task diversity and coverage" KYC example. Values SPEC doesn't name are left for an Admin. */
export const KYC_WORKFLOW = 'KYC onboarding and refresh';
export const KYC_COVERAGE: CoverageDimensions = CoverageDimensions.parse({
  dimensions: [
    { key: 'customer_type', label: 'Customer type', values: ['individual', 'sole trader', 'corporate', 'trust'] },
    { key: 'jurisdiction', label: 'Jurisdiction', values: [] },
    { key: 'risk_level', label: 'Risk level', values: ['low', 'medium', 'high'] },
    { key: 'channel', label: 'Channel', values: ['in-branch', 'remote'] },
    { key: 'document_type', label: 'Document type', values: [] },
  ],
  cells: [],
});
export const KYC_EDGE_CASES: EdgeCaseCatalog = EdgeCaseCatalog.parse(
  [
    'Expired or damaged ID',
    'Name mismatch across documents',
    'PEP link',
    'Sanctions near-match',
    'Missing proof of address',
    'Complex or circular ownership',
    'Nominee director',
    'Conflicting registry data',
    'High-risk jurisdiction',
    'Adverse media hit',
  ].map((name) => ({ name, quota: 1, required: true })),
);

export interface ImportResult {
  domainsCreated: string[];
  templatesCreated: string[];
  templatesSkipped: string[];
}

/** Applies parsed rows for one client. Idempotent: existing domains and workflows are left untouched. */
export async function importTaskflow(db: PrismaClient, clientId: string, rows: TaskflowRow[]): Promise<ImportResult> {
  const result: ImportResult = { domainsCreated: [], templatesCreated: [], templatesSkipped: [] };

  await db.$transaction(async (tx) => {
    const audit = (entityType: string, entityId: string, action: string, after: unknown) =>
      tx.auditEvent.create({
        data: {
          clientId,
          actorType: 'SYSTEM',
          actorId: 'seed:taskflow',
          entityType,
          entityId,
          action,
          after: after as Prisma.InputJsonValue,
        },
      });

    for (const row of rows) {
      let domain = await tx.domain.findFirst({ where: { clientId, name: { equals: row.domain, mode: 'insensitive' } } });
      if (!domain) {
        domain = await tx.domain.create({ data: { clientId, name: row.domain } });
        result.domainsCreated.push(domain.name);
        await audit('Domain', domain.id, 'domain.created', { name: domain.name, source: 'Taskflow.xlsx' });
      }

      const label = `${row.domain} / ${row.workflowName}`;
      const existing = await tx.template.findFirst({
        where: { clientId, domainId: domain.id, workflowName: { equals: row.workflowName, mode: 'insensitive' } },
      });
      if (existing) {
        result.templatesSkipped.push(label);
        continue;
      }

      const isKyc = row.domain === 'Banking' && row.workflowName === KYC_WORKFLOW;
      const t = await tx.template.create({
        data: {
          clientId,
          domainId: domain.id,
          lineageId: randomUUID(),
          version: 1,
          status: 'DRAFT',
          workflowName: row.workflowName,
          primaryWork: row.primaryWork,
          verificationCriteria: row.verificationCriteria,
          humanGate: row.humanGate,
          ...(isKyc
            ? {
                coverageDimensions: KYC_COVERAGE as unknown as Prisma.InputJsonValue,
                edgeCaseCatalog: KYC_EDGE_CASES as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
      });
      result.templatesCreated.push(label);
      await audit('Template', t.id, 'template.created', { ...row, status: 'DRAFT', source: 'Taskflow.xlsx' });
    }
  });

  return result;
}
