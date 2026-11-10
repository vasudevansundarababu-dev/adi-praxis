import {
  BLUEPRINT_SECTIONS,
  defaultStudioAnswers,
  publishProblems,
  sectionProblems,
  studioAnswerProblems,
  validSectionCount,
  type HarborBlueprint,
} from '@praxis/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { CATALOG_V2, catalogBlueprints, normaliseName } from '../prisma/catalog';
import { catalogMeta, dockerAvailable, ensureVerifyImage, runInDocker } from '../prisma/catalog/verify-docker';
import { agentView, buildBundle } from '../src/harbor/bundle';
import { scanForRealData } from '../src/tasks/synthetic-scan';

const blueprints = catalogBlueprints();
const bundleOf = (bp: HarborBlueprint) => buildBundle(bp, defaultStudioAnswers(bp), catalogMeta(bp)).bytes;

describe('C4 catalog blueprints (S1-17)', () => {
  it('ships the three mockup examples', () => {
    expect(blueprints.map((b) => b.workflowName).sort()).toEqual(['AML transaction-monitoring alerts', 'KYB and beneficial ownership', 'Launch of Noise Cancelling Phone']);
  });

  it.each(blueprints.map((b) => [b.workflowName, b] as const))('%s is 6/6 valid, publishable and commit-ready with defaults', (_name, { workflowName, domain, blueprint: bp }) => {
    expect(sectionProblems(bp)).toEqual(Object.fromEntries(BLUEPRINT_SECTIONS.map((s) => [s, []])));
    expect(validSectionCount(sectionProblems(bp))).toBe(6);
    expect(bp.template_meta.label).toBe(workflowName);
    expect(bp.domain_meta.title).toBe(workflowName);
    expect(bp.template_meta.domain_category).toBe(domain);
    expect(
      publishProblems({
        workflowName,
        primaryWork: bp.catalog.primary_work,
        verificationCriteria: bp.catalog.verification_criteria,
        humanGate: bp.catalog.human_gate,
        defaultTptMinutes: bp.template_meta.tpt_minutes,
        skills: bp.catalog.skills,
        taskModes: bp.catalog.task_modes,
      }),
    ).toEqual([]);
    expect(Object.values(studioAnswerProblems(bp, defaultStudioAnswers(bp))).flat()).toEqual([]);
    expect(bp.authored_content.solve_sh.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    for (const m of bp.step_5_default_rubric.milestones) expect(m.verifier_body.trim(), m.id).not.toBe('');
  });

  it.each(blueprints.map((b) => [b.workflowName, b.blueprint] as const))('%s holds synthetic data only', (_name, bp) => {
    expect(scanForRealData(JSON.stringify(bp))).toEqual([]);
    expect(JSON.stringify(bp)).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it.each(blueprints.map((b) => [b.workflowName, b.blueprint] as const))('%s builds a deterministic bundle with no hidden path in the agent view', (_name, bp) => {
    const a = buildBundle(bp, defaultStudioAnswers(bp), catalogMeta(bp));
    expect(buildBundle(bp, defaultStudioAnswers(bp), catalogMeta(bp)).sha256).toBe(a.sha256);
    expect(agentView(a.manifest).some((e) => /^(eval|solution)\//.test(e.path))).toBe(false);
    expect(a.manifest.find((e) => e.path === 'solution/solve.sh')?.hidden).toBe(true);
  });

  it('the catalog lists exactly the mockup workflows (D15)', () => {
    expect(CATALOG_V2.map((d) => [d.name, d.workflows.length])).toEqual([
      ['Digital Marketing', 3],
      ['Banking', 10],
    ]);
    expect(normaliseName('Fraud–risk/compliance handoffs')).toBe(normaliseName('Fraud-risk/compliance handoffs'));
    expect(normaliseName('  KYB and  Beneficial ownership ')).toBe('kyb and beneficial ownership');
  });

  it('the owner removed Control testing and Country-specific interpretation (10 Nov 2026)', () => {
    const names = CATALOG_V2.flatMap((d) => d.workflows.map((w) => w.workflowName));
    expect(names).not.toContain('Control testing');
    expect(names).not.toContain('Country-specific interpretation');
  });

  it('every workflow without a blueprint carries publish fields that pass the publish rules (D15, 10 Nov 2026)', () => {
    const fromFields = CATALOG_V2.flatMap((d) => d.workflows.filter((w) => !w.blueprint).map((w) => ({ domain: d.name, workflowName: w.workflowName, fields: w.fields! })));
    expect(fromFields.map((f) => f.workflowName).sort()).toEqual(
      [
        'Q4 Global Paid Search Query Clustering',
        'Omnichannel Creative & Locale Compliance',
        'Adverse media review',
        'Audit and evidence preparation',
        'Communications surveillance',
        'Compliance monitoring',
        'Customer risk rating',
        'Enhanced due diligence',
        'Fraud-risk/compliance handoffs',
        'Issue and remediation tracking',
      ].sort(),
    );
    for (const { workflowName, fields } of fromFields) {
      expect(fields, workflowName).toBeDefined();
      expect(fields.defaultTptMinutes, workflowName).toBeGreaterThan(0);
      expect(fields.skills.length, workflowName).toBeGreaterThan(0);
      expect(fields.taskModes.length, workflowName).toBeGreaterThan(0);
      expect(publishProblems({ workflowName, ...fields }), workflowName).toEqual([]);
    }
  });
});

/**
 * Hermetic proof that the null agent scores 0.00 and the oracle 1.00 (S1-17, S3-04 checks 04 and 05).
 * Runs real pytest and solve.sh in `docker run --network=none`; on demand with HARBOR_DOCKER=1 (not in CI).
 */
describe.skipIf(process.env.HARBOR_DOCKER !== '1' || !dockerAvailable())('C4 Docker verification (--network=none)', () => {
  beforeAll(ensureVerifyImage, 300_000);

  it.each(blueprints.map((b) => [b.workflowName, b.blueprint] as const))('%s: null agent 0.00, oracle 1.00', (_name, bp) => {
    const bytes = bundleOf(bp);
    expect(runInDocker(bytes, 'null-agent').score).toBe(0);
    expect(runInDocker(bytes, 'oracle').score).toBe(1);
  });

  const call = (tool: string, args: object) => `python3 environment/mcp_mock.py call ${tool} '${JSON.stringify(args)}' > /dev/null`;

  it('a guardrail breach scores -1.00 even when the oracle work is done', () => {
    const kyb = blueprints.find((b) => b.workflowName === 'KYB and beneficial ownership')!.blueprint;
    const script = `bash solution/solve.sh\n${call('record_decision', { company_id: 'GB-10045', decision: 'AUTO_APPROVE', rationale: 'Approved automatically by the agent.' })}\n`;
    expect(runInDocker(bundleOf(kyb), { agentScript: script }).score).toBe(-1);
  });

  it('partial work scores the weights of the milestones it passes', () => {
    const mktg = blueprints.find((b) => b.workflowName === 'Launch of Noise Cancelling Phone')!.blueprint;
    const weeks = Array.from({ length: 12 }, (_, i) => call('advance_campaign_week', { week: i + 1, spend_usd: 10000 })).join('\n');
    expect(runInDocker(bundleOf(mktg), { agentScript: `${weeks}\n` }).score).toBe(0.3);
    const overspend = `${call('advance_campaign_week', { week: 1, spend_usd: 25000 })}\n`;
    expect(runInDocker(bundleOf(mktg), { agentScript: overspend }).score).toBe(-1);
  });
});
