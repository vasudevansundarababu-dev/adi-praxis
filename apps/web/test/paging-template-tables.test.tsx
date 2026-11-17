import { TemplateDirectoryResponse, type SourcingImportResult } from '@praxis/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RulesTable, type RulesTableRule } from '@/components/policy/rules-table';
import { ImportPreview } from '@/components/sourcing/import-sheet';
import { DirectoryView } from '@/components/templates/directory/directory-view';
import { handleMock, resetMockStore } from '@/lib/mc/mock-backend';
import { ctx, DOMAIN_BANK, fixtureSource, html, template, text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));

const rule = (n: number): RulesTableRule => ({
  ruleId: `r${n}`,
  ruleKey: `R-${n}`,
  title: `Rule number ${n}`,
  required: true,
  state: 'DRAFT',
  applied: false,
  documentIds: ['d1'],
  definitionProblems: [],
  evidenceProblems: [],
  versionId: `v${n}`,
  version: 1,
  contentHash: 'a'.repeat(64),
  requirement: 'A synthetic requirement.',
  evidence: { quote: 'A synthetic quote.', resolution: 'RESOLVED', document: 'SEED policy', documentVersion: 1 },
});

beforeEach(() => resetMockStore());

/** D24: template, policy and sourcing tables show 10 rows per page with the shared pagination bar. */
describe('paged template and policy tables (D24)', () => {
  it('the rules table shows the first 10 of 23 rules with the count and page links', () => {
    const markup = html(<RulesTable projectId="p1" documents={[{ id: 'd1', title: 'Policy' }]} rules={Array.from({ length: 23 }, (_, i) => rule(i + 1))} />);
    const t = text(markup);
    expect(t).toContain('Showing 10 of 23 rules');
    expect(t).toContain('Rule number 10');
    expect(t).not.toContain('Rule number 11');
    expect(markup).toContain('aria-label="Page 3"');
    expect(markup).toContain('aria-label="Next page"');
  });

  it('the import preview pages its rows; a short sheet shows the count without page buttons', () => {
    const rows = (n: number): SourcingImportResult =>
      ({ valid: n, rows: Array.from({ length: n }, (_, i) => ({ row: i + 2, firstName: `First${i + 1}`, lastName: 'Synthetic', email: `p${i + 1}@example.test`, ok: true, problems: [] })) }) as unknown as SourcingImportResult;
    const many = text(html(<ImportPreview result={rows(14)} />));
    expect(many).toContain('Showing 10 of 14 rows');
    expect(many).not.toContain('First11 ');
    const one = html(<ImportPreview result={rows(1)} />);
    expect(text(one)).toContain('Showing 1 of 1 row');
    expect(one).not.toContain('aria-label="Next page"');
  });

  it('the templates directory pages workflows across sections; ?page=2 shows the rest and a search counts only matches', async () => {
    const templates = Array.from({ length: 12 }, (_, i) => template({ workflowName: `Workflow ${String(i + 1).padStart(2, '0')}`, domainId: DOMAIN_BANK, domainName: 'Banking' }));
    const r = await handleMock('GET', '/templates/directory', undefined, ctx(['ADMIN'], fixtureSource(templates)));
    const data = TemplateDirectoryResponse.parse(r.body);
    const total = data.domains.reduce((n, d) => n + d.rows.length, 0);

    const first = html(<DirectoryView data={data} />);
    expect(text(first)).toContain(`Showing 10 of ${total} workflows`);
    expect(first.match(/data-search-id=/g)).toHaveLength(10);
    expect(first).toContain('href="?page=2"');

    const second = html(<DirectoryView data={data} searchParams={{ page: '2' }} />);
    expect(text(second)).toContain(`Showing ${total - 10} of ${total} workflows`);
    expect(second.match(/data-search-id=/g)).toHaveLength(total - 10);

    const ids = new Set(data.domains.flatMap((d) => d.rows).slice(0, 3).map((row) => row.templateId));
    const searched = html(<DirectoryView data={data} searchParams={{ q: 'workflow', page: '2' }} query="workflow" matchIds={ids} />);
    expect(text(searched)).toContain('Showing 3 of 3 workflows');
    expect(searched.match(/data-search-id=/g)).toHaveLength(3);
    expect(text(searched)).not.toContain('No workflows yet.');
  });
});
