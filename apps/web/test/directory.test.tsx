import { HarborBlueprint, TemplateDirectoryResponse } from '@praxis/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { DirectoryView } from '@/components/templates/directory/directory-view';
import { BlueprintSummary } from '@/components/templates/compiler/blueprint-summary';
import { McHeader } from '@/components/templates/mc-header';
import { sampleBlueprintInput } from '@/lib/mc/fixtures';
import { filterDomains, tptText } from '@/lib/mc/format';
import { handleMock, mockStore, resetMockStore } from '@/lib/mc/mock-backend';
import { ctx, DOMAIN_BANK, DOMAIN_EMPTY, DOMAIN_MKTG, fixtureSource, html, project, template, text } from './helpers';

const published = template({ status: 'PUBLISHED', workflowName: 'KYB and beneficial ownership', domainId: DOMAIN_BANK, domainName: 'Banking' });
const draft = template({ workflowName: 'Launch of Noise Cancelling Phone' });
const source = fixtureSource([published, draft], [project()]);

async function directory(roles: string[]) {
  const r = await handleMock('GET', '/templates/directory', undefined, ctx(roles, source));
  expect(r.status).toBe(200);
  return TemplateDirectoryResponse.parse(r.body);
}

beforeEach(() => resetMockStore());

describe('U1 Screen 1 directory', () => {
  it('S1-01: groups workflows under domain headers with counts; an empty domain shows "No workflows yet" to Admin only', async () => {
    const admin = html(<DirectoryView data={await directory(['ADMIN'])} />);
    expect(text(admin)).toContain('Digital Marketing 1');
    expect(text(admin)).toContain('Banking 1');
    expect(text(admin)).toContain('Healthcare 0');
    expect(text(admin)).toContain('No workflows yet.');
    const pm = await directory(['PM']);
    expect(pm.domains.map((d) => d.domainId)).toEqual([DOMAIN_BANK]);
    expect(text(html(<DirectoryView data={pm} />))).not.toContain('Healthcare');
  });

  it('S1-02: filter pills link to ?domain= and only the chosen section renders; unknown ids fall back to All', async () => {
    const data = await directory(['ADMIN']);
    const markup = html(<DirectoryView data={data} domainFilter={DOMAIN_BANK} />);
    expect(markup).toContain(`href="/templates?domain=${DOMAIN_BANK}"`);
    expect(markup).toContain('href="/templates"');
    expect(markup).toContain(`id="domain-${DOMAIN_BANK}"`);
    expect(markup).not.toContain(`id="domain-${DOMAIN_MKTG}"`);
    expect(markup).toMatch(new RegExp(`aria-current="true" href="/templates\\?domain=${DOMAIN_BANK}"`));
    expect(filterDomains(data, 'nope').selected).toBeNull();
    expect(filterDomains(data, undefined).domains).toHaveLength(3);
  });

  it('S1-03: summary cards show server counts and render 0, never a placeholder', async () => {
    const t = text(html(<DirectoryView data={await directory(['ADMIN'])} />));
    expect(t).toContain('Total Templates 2');
    expect(t).toContain('Active SME Studios 0');
    expect(t).toContain('Attached Projects & SMEs 0 / 0');
    expect(t).toMatch(/Authored Tasks \d+/);
  });

  it('S1-04 to S1-09: every row has workflow link, vN, status badge, TPT with horizon, modes and Unassigned', async () => {
    const markup = html(<DirectoryView data={await directory(['ADMIN'])} />);
    const t = text(markup);
    expect(markup).toContain(`href="/templates/${draft.id}"`);
    expect(t).toContain('v1');
    expect(t).toContain('Draft');
    expect(t).toContain('Published');
    expect(t).toContain('45m (12 Wks)');
    expect(t).toContain('Hermetic MCP');
    expect(t).toContain('Unassigned');
    expect(t).toContain('Edit Template');
    expect(tptText(null, 'x')).toBe('—');
    expect(tptText(35, '15 Steps')).toBe('35m (15 Steps)');
    // DEF-1: seeded blueprints store the full text; it is never wrapped twice (directory and Screen 2 summary).
    expect(tptText(45, '45m (12 Wks)')).toBe('45m (12 Wks)');
    expect(tptText(30, ' 30m (4 Wks) ')).toBe('30m (4 Wks)');
    expect(tptText(40, '')).toBe('40m');
  });

  it('S1-07, S1-10, S1-11: an Active deployment shows the emerald Active badge, project, SME email and SME UI link (Admin)', async () => {
    const data = await directory(['ADMIN']);
    const row = data.domains.find((d) => d.domainId === DOMAIN_MKTG)!.rows[0]!;
    row.status = 'ACTIVE';
    row.deployments = [{ id: published.id, projectId: published.id, projectName: 'SYNTHETIC pilot', status: 'ACTIVE', smeEmail: 'sme@example.test', studioUrl: 'http://localhost:3131/studio/launch-abc123' }];
    const markup = html(<DirectoryView data={data} />);
    expect(markup).toMatch(/pill pill-success">Active/);
    expect(text(markup)).toContain('SYNTHETIC pilot sme@example.test');
    expect(markup).toMatch(/href="http:\/\/localhost:3131\/studio\/launch-abc123" target="_blank" rel="noopener noreferrer"/);
  });

  it('S1-12, S1-13: no New template or Add domain control', async () => {
    const t = text(html(<DirectoryView data={await directory(['ADMIN'])} />));
    expect(t).not.toMatch(/new template/i);
    expect(t).not.toMatch(/add domain/i);
  });

  it('S1-14: the header shortcut "Tasks DB & JSON" is Admin only and shows the active workflow + version', () => {
    expect(text(html(<McHeader isAdmin />))).toContain('Tasks DB & JSON');
    expect(text(html(<McHeader isAdmin={false} />))).not.toContain('Tasks DB');
    expect(text(html(<McHeader isAdmin active={{ workflowName: 'KYB', version: 3 }} />))).toContain('KYB v3');
  });

  it('S1-15: PM sees published only, no drafts, emails, studio URLs or validity; rows offer Create project', async () => {
    const data = await directory(['PM']);
    expect(data.view).toBe('PM');
    const rows = data.domains.flatMap((d) => d.rows);
    expect(rows.map((r) => r.templateId)).toEqual([published.id]);
    expect(rows.every((r) => r.deployments.length === 0)).toBe(true);
    const markup = html(<DirectoryView data={data} />);
    expect(markup).toContain(`href="/projects/new?templateId=${published.id}"`);
    expect(text(markup)).not.toMatch(/Edit Template|SME UI|Assigned SME|valid/);
  });

  it('the mock directory is client data only: no rows for unknown domains, and Admin rows carry validity', async () => {
    const data = await directory(['ADMIN']);
    expect(data.domains.find((d) => d.domainId === DOMAIN_EMPTY)!.rows).toEqual([]);
    expect(data.domains.flatMap((d) => d.rows).every((r) => r.validSections === 6)).toBe(true);
    expect(mockStore().blueprints.size).toBe(2);
  });
});

describe('DEF-1 on the PM blueprint summary (S1-08, S1-15)', () => {
  it('shows a seeded "45m (12 Wks)" label once', () => {
    const input = sampleBlueprintInput();
    input.template_meta!.tpt_label = '45m (12 Wks)';
    const t = text(html(<BlueprintSummary bp={HarborBlueprint.parse(input)} templateId="t-1" />));
    expect(t).toContain('TPT 45m (12 Wks)');
    expect(t).not.toContain('45m (45m');
  });
});
