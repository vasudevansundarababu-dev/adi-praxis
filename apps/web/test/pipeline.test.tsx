import type { GenerationRunDto, StudioDeploymentDto, TemplateDirectoryResponse, VerificationRunDto } from '@praxis/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { Pipeline, type PipelineProps } from '@/components/templates/deploy/pipeline';
import type { DeploymentTarget, ModelOption, ModelsResponse } from '@/lib/mc/browser';
import { handleMock, resetMockStore } from '@/lib/mc/mock-backend';
import { canDeploy, deployHint, gatesPassed, modelChoices, POLL_MS } from '@/lib/mc/pipeline';
import { ctx, fixtureSource, html, project, template, text } from './helpers';

beforeEach(() => resetMockStore());

const T = template({ id: '00000000-0000-4000-8000-00000000a001' });
const P = project({ id: '00000000-0000-4000-8000-00000000b001', templateId: T.id, workflowName: T.workflowName, name: 'SYNTHETIC Launch pilot' });
const OTHER = project({ id: '00000000-0000-4000-8000-00000000b002', templateId: '00000000-0000-4000-8000-00000000ffff', workflowName: 'Other workflow', name: 'Other project' });

function clock(start = Date.UTC(2026, 10, 7, 12)) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

function verification(over: Partial<VerificationRunDto> = {}): VerificationRunDto {
  const ids = ['01_bundle_layout', '02_hidden_paths', '03_network_internal', '04_zero_baseline', '05_oracle_solve'] as const;
  return {
    id: '00000000-0000-4000-8000-00000000c001',
    generationRunId: '00000000-0000-4000-8000-00000000d001',
    status: 'SUCCEEDED',
    checks: ids.map((id) => ({ id, passed: true, value: id === '04_zero_baseline' ? '0.00' : id === '05_oracle_solve' ? '1.00' : 'ok', evidence: null })),
    zeroBaselineScore: 0,
    oracleScore: 1,
    bundleSha256: 'a'.repeat(64),
    logTail: '[verifier] 05_oracle_solve: PASS (1.00)',
    createdAt: '2026-11-07T12:00:00.000Z',
    finishedAt: '2026-11-07T12:00:05.000Z',
    ...over,
  };
}

const MODELS: ModelsResponse = {
  items: [
    { provider: 'claude', model: 'claude-sonnet-5', label: 'Claude claude-sonnet-5 (Vertex AI)', available: true },
    { provider: 'gemini', model: 'gemini-3-pro', label: 'Gemini gemini-3-pro (Vertex AI)', available: false },
  ],
  liveAi: true,
  codegenEnabled: false,
};
const TARGETS: DeploymentTarget[] = [{ id: P.id, name: P.name, templateVersion: 1, smes: [{ candidateId: '00000000-0000-4000-8000-00000000e001', displayName: 'Synthetic SME', email: 'sme@example.test' }] }];
const props = (over: Partial<PipelineProps> = {}): PipelineProps => ({ templateId: T.id, models: MODELS, targets: TARGETS, deployments: [], initialGeneration: null, initialVerification: null, ...over });

describe('U3 pipeline rules', () => {
  it('S3-01: only Claude and Gemini (plus the local mock) are offered; never OpenAI', () => {
    const items = [...MODELS.items, { provider: 'openai', model: 'gpt-x', label: 'OpenAI', available: true } as unknown as ModelOption];
    expect(modelChoices(items).map((m) => m.provider)).toEqual(['claude', 'gemini']);
  });

  it('S3-05: Deploy needs checks 04 and 05 and both selections', () => {
    const v = verification();
    expect(gatesPassed(v)).toBe(true);
    expect(canDeploy(v, P.id, 'sme')).toBe(true);
    expect(canDeploy(v, P.id, '')).toBe(false);
    expect(canDeploy(v, '', 'sme')).toBe(false);
    const failed = verification({ status: 'FAILED', zeroBaselineScore: 0.4, checks: verification().checks.map((c) => (c.id === '04_zero_baseline' ? { ...c, passed: false, value: '0.40' } : c)) });
    expect(canDeploy(failed, P.id, 'sme')).toBe(false);
    expect(deployHint(failed, P.id, 'sme')).toBe('Checks 04 and 05 must pass before deploying.');
    expect(deployHint(null, '', '')).toBe('Run Step 2 first.');
    expect(deployHint(verification({ status: 'RUNNING' }), '', '')).toBe('Waiting for the checks to finish.');
    expect(canDeploy(verification({ oracleScore: 0.9 }), P.id, 'sme')).toBe(false);
  });

  it('S3-08: logs and progress are polled at 2 s or less', () => {
    expect(POLL_MS).toBeLessThanOrEqual(2000);
  });
});

describe('U3 mock routes (Stream 2 stand-in)', () => {
  it('S3-02: the models list carries no key material', async () => {
    const r = await handleMock('GET', '/meta-compiler/models', undefined, ctx(['ADMIN'], fixtureSource([T])));
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/key|secret|token|credential/i);
    expect((await handleMock('GET', '/meta-compiler/models', undefined, ctx(['PM'], fixtureSource([T])))).status).toBe(403);
  });

  it('S3-03 to S3-06, S3-09: generate, verify, then deploy only to an assigned SME, at a stable URL', async () => {
    const c = clock();
    const cx = ctx(['ADMIN'], fixtureSource([T], [P, OTHER]), c.now);
    const targets = (await handleMock('GET', `/templates/${T.id}/deployment-targets`, undefined, cx)).body as { projects: DeploymentTarget[] };
    expect(targets.projects.map((p) => p.name)).toEqual(['SYNTHETIC Launch pilot']);
    const sme = targets.projects[0]!.smes[0]!.candidateId;

    const gen = (await handleMock('POST', `/templates/${T.id}/generations`, { provider: 'mock', model: 'mock-drafter-1' }, cx)).body as GenerationRunDto;
    expect(gen.progress.ui).toBe(0);
    expect((await handleMock('POST', `/generations/${gen.id}/verifications`, {}, cx)).status).toBe(409);
    c.advance(1500);
    const mid = (await handleMock('GET', `/generations/${gen.id}`, undefined, cx)).body as GenerationRunDto;
    expect(mid.status).toBe('RUNNING');
    expect(mid.progress.ui).toBeGreaterThan(0);
    c.advance(5000);
    expect(((await handleMock('GET', `/generations/${gen.id}`, undefined, cx)).body as GenerationRunDto).status).toBe('SUCCEEDED');

    const ver = (await handleMock('POST', `/generations/${gen.id}/verifications`, {}, cx)).body as VerificationRunDto;
    const early = await handleMock('POST', `/templates/${T.id}/deployments`, { verificationRunId: ver.id, projectId: P.id, smeCandidateId: sme }, cx);
    expect(early).toMatchObject({ status: 409, body: { error: 'GATES_NOT_PASSED' } });
    c.advance(6000);
    const done = (await handleMock('GET', `/verifications/${ver.id}`, undefined, cx)).body as VerificationRunDto;
    expect(gatesPassed(done)).toBe(true);
    expect(done.checks.map((x) => x.value)).toContain('0.00');

    const wrongSme = await handleMock('POST', `/templates/${T.id}/deployments`, { verificationRunId: ver.id, projectId: P.id, smeCandidateId: '00000000-0000-4000-8000-0000000000ff' }, cx);
    expect(wrongSme.status).toBe(422);
    const wrongProject = await handleMock('POST', `/templates/${T.id}/deployments`, { verificationRunId: ver.id, projectId: OTHER.id, smeCandidateId: sme }, cx);
    expect(wrongProject.status).toBe(404);

    const d1 = (await handleMock('POST', `/templates/${T.id}/deployments`, { verificationRunId: ver.id, projectId: P.id, smeCandidateId: sme }, cx)).body as StudioDeploymentDto;
    expect(d1.studioUrl).toMatch(/^http:\/\/localhost:3131\/studio\/[a-z0-9-]+$/);
    const d2 = (await handleMock('POST', `/templates/${T.id}/deployments`, { verificationRunId: ver.id, projectId: P.id, smeCandidateId: sme }, cx)).body as StudioDeploymentDto;
    expect(d2.studioUrl).toBe(d1.studioUrl);
    const list = (await handleMock('GET', `/templates/${T.id}/deployments`, undefined, cx)).body as { items: StudioDeploymentDto[] };
    expect(list.items.filter((d) => d.status === 'ACTIVE')).toHaveLength(1);
    const dir = (await handleMock('GET', '/templates/directory', undefined, cx)).body as TemplateDirectoryResponse;
    expect(dir.domains.flatMap((d) => d.rows).find((r) => r.templateId === T.id)?.status).toBe('ACTIVE');

    // S3-10: Stop keeps the row (and URL) and is idempotent; only an Admin may stop.
    const stopped = await handleMock('POST', `/deployments/${d1.id}/stop`, {}, cx);
    expect(stopped.body).toMatchObject({ id: d1.id, status: 'STOPPED', studioUrl: d1.studioUrl });
    expect((await handleMock('POST', `/deployments/${d1.id}/stop`, {}, cx)).status).toBe(200);
    expect((await handleMock('POST', '/deployments/no-such/stop', {}, cx)).status).toBe(404);
  });
});

describe('U3 Screen 3 rendering', () => {
  it('S3-01: model selector lists Claude and Gemini; unavailable models are disabled', () => {
    const m = html(<Pipeline {...props()} />);
    expect(m).toContain('Claude claude-sonnet-5 (Vertex AI)');
    expect(m).toMatch(/<option value="gemini:gemini-3-pro" disabled="">/);
    expect(m).not.toMatch(/openai/i);
  });

  it('S3-03: Step 1 shows UI and backend progress bars with the cost estimate', () => {
    const gen: GenerationRunDto = {
      id: '00000000-0000-4000-8000-00000000d001',
      templateId: T.id,
      templateVersion: 1,
      mode: 'BLUEPRINT',
      provider: 'claude',
      model: 'claude-sonnet-5',
      status: 'RUNNING',
      progress: { ui: 60, backend: 20, message: 'Compiling the SME studio UI from the UISpec…' },
      estimatedCostUsd: 0.42,
      actualCostUsd: null,
      outputSha256: null,
      error: null,
      createdAt: '2026-11-07T12:00:00.000Z',
      finishedAt: null,
    };
    const m = html(<Pipeline {...props({ initialGeneration: gen })} />);
    expect(m).toMatch(/role="progressbar" aria-label="UI compilation"[^>]*aria-valuenow="60"/);
    expect(m).toMatch(/role="progressbar" aria-label="Backend \(persistence and MCP simulator\)"[^>]*aria-valuenow="20"/);
    expect(text(m)).toContain('Estimated cost $0.4200');
    expect(text(m)).toContain('Step 2 starts after Step 1 succeeds.');
  });

  it('S3-04/S3-08: five check cards with measured values and a log panel', () => {
    const m = html(<Pipeline {...props({ initialVerification: verification() })} />);
    for (const id of ['01_bundle_layout', '02_hidden_paths', '03_network_internal', '04_zero_baseline', '05_oracle_solve']) expect(m).toContain(`data-testid="check-${id}"`);
    expect(text(m)).toContain('Zero-baseline score 0.00 · Oracle score 1.00');
    expect(m).toContain('role="log"');
    expect(text(m)).toContain('05_oracle_solve: PASS (1.00)');
  });

  it('S3-05: Deploy stays disabled until the gates pass and both selections are made', () => {
    const before = html(<Pipeline {...props()} />);
    expect(before).toMatch(/<button type="button" class="btn btn-primary" disabled=""[^>]*>Deploy studio/);
    expect(text(before)).toContain('Run Step 2 first.');
    const after = html(<Pipeline {...props({ initialVerification: verification() })} />);
    expect(text(after)).toContain('Gates passed');
    expect(text(after)).toContain('Choose a project.');
  });

  it('S3-09: existing studios stay listed with their URL', () => {
    const d: StudioDeploymentDto = { id: '00000000-0000-4000-8000-00000000f001', templateId: T.id, templateVersion: 1, projectId: P.id, smeCandidateId: TARGETS[0]!.smes[0]!.candidateId, studioKey: 'launch-abc123', studioUrl: 'http://localhost:3131/studio/launch-abc123', status: 'ACTIVE', runtime: 'SHARED', createdAt: '2026-11-07T12:00:00.000Z' };
    const t = text(html(<Pipeline {...props({ deployments: [d] })} />));
    expect(t).toContain('Studios for this workflow');
    expect(t).toContain('http://localhost:3131/studio/launch-abc123');
  });

  it('S3-10: each active studio has a Stop button; a stopped studio shows Stopped and no button', () => {
    const base = { templateId: T.id, templateVersion: 1, projectId: P.id, smeCandidateId: TARGETS[0]!.smes[0]!.candidateId, runtime: 'SHARED' as const, createdAt: '2026-11-10T00:00:00.000Z' };
    const live: StudioDeploymentDto = { ...base, id: '00000000-0000-4000-8000-00000000f001', studioKey: 'launch-live01', studioUrl: 'http://localhost:3131/studio/launch-live01', status: 'ACTIVE' };
    const stopped: StudioDeploymentDto = { ...base, id: '00000000-0000-4000-8000-00000000f002', studioKey: 'launch-stop01', studioUrl: 'http://localhost:3131/studio/launch-stop01', status: 'STOPPED' };
    const m = html(<Pipeline {...props({ deployments: [live, stopped] })} />);
    expect(m.match(/>Stop studio</g)).toHaveLength(1);
    expect(text(m)).toContain('Stopped');
  });
});
