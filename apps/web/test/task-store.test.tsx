import type { SmeAuthoredTaskDto } from '@praxis/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { McHeader } from '@/components/templates/mc-header';
import { JudgeResultView } from '@/components/templates/tasks/judge-panel';
import { TaskStore } from '@/components/templates/tasks/task-store';
import type { JudgeView } from '@/lib/mc/browser';
import { handleMock, resetMockStore } from '@/lib/mc/mock-backend';
import { ctx, fixtureSource, html, template, text } from './helpers';

beforeEach(() => resetMockStore());

const T = template({ id: '00000000-0000-4000-8000-00000000a101' });

async function items(roles: string[]) {
  return handleMock('GET', '/studio-tasks', undefined, ctx(roles, fixtureSource([T])));
}

describe('U4 task store routes (Stream 2 stand-in)', () => {
  it('S4-11/S4-12: Admin only; PMs get 403 for the list, a task, its bundle and the export', async () => {
    const pm = ctx(['PM'], fixtureSource([T]));
    expect((await items(['PM'])).status).toBe(403);
    const list = (await items(['ADMIN'])).body as { items: SmeAuthoredTaskDto[] };
    expect(list.items.length).toBeGreaterThan(0);
    const id = list.items[0]!.id;
    for (const path of [`/studio-tasks/${id}`, `/studio-tasks/${id}/bundle`, '/studio-tasks/export']) expect((await handleMock('GET', path, undefined, pm)).status).toBe(403);
  });

  it('S4-11: Inspect JSON returns the stored task JSON; S4-12: export carries every task as an attachment', async () => {
    const admin = ctx(['ADMIN'], fixtureSource([T]));
    const list = (await items(['ADMIN'])).body as { items: SmeAuthoredTaskDto[] };
    const detail = await handleMock('GET', `/studio-tasks/${list.items[0]!.id}`, undefined, admin);
    expect(detail.body).toMatchObject({ externalTaskId: list.items[0]!.externalTaskId, taskJson: { data_classification: 'synthetic', network: 'internal' } });
    const exp = await handleMock('GET', '/studio-tasks/export', undefined, admin);
    expect(exp.headers?.['content-disposition']).toMatch(/attachment/);
    expect((exp.body as { items: unknown[] }).items).toHaveLength(list.items.length);
  });
});

describe('U4 task store page', () => {
  const task: SmeAuthoredTaskDto = {
    id: '00000000-0000-4000-8000-00000000a201',
    externalTaskId: 'TASK-MKTG-901',
    taskInstanceId: '00000000-0000-4000-8000-00000000a202',
    submissionVersion: 1,
    templateId: T.id,
    templateVersion: 2,
    workflowName: 'Launch of Noise Cancelling Phone',
    projectId: '00000000-0000-4000-8000-00000000a203',
    projectName: 'SYNTHETIC Launch pilot',
    authoredBy: 'sme.demo@example.test',
    title: 'Q4 launch, UK only (synthetic)',
    executionMode: 'HERMETIC_MCP',
    bundleSha256: 'b'.repeat(64),
    zeroBaselineScore: 0,
    oracleScore: 1,
    dataClassification: 'SYNTHETIC',
    reviewStatus: 'SUBMITTED',
    createdAt: '2026-11-07T10:00:00.000Z',
  };

  it('S4-11: table columns, DB & Harbor status, Inspect JSON and bundle download', () => {
    const m = html(<TaskStore tasks={[task]} />);
    const t = text(m);
    for (const h of ['Task ID', 'Template / Workflow', 'Project', 'Authored by', 'Title', 'DB & Harbor', 'Review', 'Actions']) expect(t).toContain(h);
    expect(t).toContain('TASK-MKTG-901');
    expect(t).toContain('Launch of Noise Cancelling Phone (v2)');
    expect(t).toContain('sme.demo@example.test');
    expect(t).toContain('zero-baseline 0.00 · oracle 1.00');
    expect(t).toContain('Submitted for review');
    expect(t).toContain('Inspect JSON for TASK-MKTG-901');
    expect(m).toContain(`href="/api/v1/studio-tasks/${task.id}/bundle"`);
  });

  it('S4-12: Export all links to the export route', () => {
    expect(html(<TaskStore tasks={[]} />)).toContain('href="/api/v1/studio-tasks/export"');
    expect(text(html(<TaskStore tasks={[]} />))).toContain('No studio tasks yet.');
  });

  it('S1-14: the "Tasks DB & JSON" shortcut is shown to Admins only', () => {
    expect(html(<McHeader isAdmin />)).toContain('href="/templates/tasks"');
    expect(html(<McHeader isAdmin={false} />)).not.toContain('/templates/tasks');
  });
});

describe('J4 judge result (Admin only)', () => {
  const judge: JudgeView = {
    status: 'MEASURED',
    provider: 'mock',
    model: 'mock-judge-1',
    score: 0.625,
    costUsd: 0.0123,
    judgedAt: '2026-11-07T10:05:00.000Z',
    error: null,
    milestones: [
      {
        milestoneId: 'launch_memo',
        weight: 30,
        pointsEarned: 3,
        pointsPossible: 6,
        truncated: true,
        criteria: [
          { num: 1, category: 'Budget', text: 'States the synthetic budget', points: 2, awarded: 2, passed: true, evidence: 'Budget line in section 2' },
          { num: 2, category: '', text: 'Plans the review week', points: 4, awarded: 1, passed: false, evidence: 'Review week missing' },
        ],
      },
    ],
  };

  it('shows the score, model, cost and a per-milestone table with points and evidence', () => {
    const t = text(html(<JudgeResultView judge={judge} />));
    expect(t).toContain('Judge score 0.63');
    expect(t).toContain('Model mock-judge-1');
    expect(t).toContain('Cost $0.0123');
    expect(t).toContain('launch_memo · 3 of 6 points · weight 30');
    expect(t).toContain('truncated to 60,000 characters');
    expect(t).toContain('Budget: States the synthetic budget 2 of 2 Budget line in section 2');
    expect(t).toContain('Plans the review week 1 of 4 Review week missing');
    expect(text(html(<JudgeResultView judge={null} />))).toMatch(/No judge result yet/);
  });

  it('RBAC: only Admin reads it; Reviewer, PM, Finance and roleless callers get 403', async () => {
    const list = (await items(['ADMIN'])).body as { items: SmeAuthoredTaskDto[] };
    const path = `/studio-tasks/${list.items[0]!.id}/judge`;
    expect((await handleMock('GET', path, undefined, ctx(['ADMIN'], fixtureSource([T])))).status).toBe(200);
    for (const roles of [['REVIEWER'], ['PM'], ['FINANCE'], []]) expect((await handleMock('GET', path, undefined, ctx(roles, fixtureSource([T])))).status).toBe(403);
  });
});
