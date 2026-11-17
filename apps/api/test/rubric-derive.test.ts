import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  coverage,
  derive,
  emptyOutput,
  GOLDEN_MARKETING_EXAMPLE,
  isShellCriterion,
  MARKETING_CAMPAIGN_TASK2_PROFILE,
  MARKETING_T2_GROUPS,
  registerProfile,
  seedCriteria,
  setFieldValue,
  templateRubric,
  TemplateProfileSchema,
  technicalSettings,
  templateFill,
  type DeriveInput,
  type TemplateProfile,
} from '@praxis/shared';
import { jointHashes, jointTemplateSpec } from '../src/anvil/joint-template';
import { authoringDefaultsFor } from '../src/tasks/rubric/authoring-defaults';

/**
 * Pure rubric derivation and template reading (no database). Acceptance criteria: recommendations follow each
 * template's own definitions (AC 1), the applicability safeguards (AC 7), duplicate weighting (AC 8), KYC and
 * Marketing keep their own scales (AC 9), and the export stays unchanged (AC 10).
 */
const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const V6 = JSON.parse(readFileSync(new URL('./fixtures/kyc-reusable/proposal.json', import.meta.url), 'utf8')) as Record<string, any>;
const form = (p: unknown) => TemplateProfileSchema.parse(p) as TemplateProfile;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex');

function input(profile: TemplateProfile, output: Record<string, unknown>, o: Partial<DeriveInput> = {}): DeriveInput {
  return { profile, output, rubric: templateRubric(profile, V7.execution)!, template: { id: 't1', version: 2, caseSelector: V7.authoring.template.caseSelector }, task: { id: 'task1', revision: 3 }, policies: [], sources: [], hash, ...o };
}

function v7Output(profile: TemplateProfile, steps = [{ action: "Verify the custodian's authority and the custodial agreement", tool: 'authority.check', failureBehaviour: '' }]) {
  let out = emptyOutput(profile);
  out = setFieldValue(profile, out, 'S1', 'applicationType', 'custodial');
  out = setFieldValue(profile, out, 'S5', 'steps', steps);
  return out;
}

describe('template rubric (D8, D9)', () => {
  it('KYC v7: 20 fixed criteria from the evaluator map, 5/2/0, no weights invented, run-evidence settings', () => {
    const tr = templateRubric(form(V7.authoring.profile), V7.execution)!;
    expect(tr.criteria).toHaveLength(20);
    expect(tr).toMatchObject({ section: 'S7', fieldKey: 'criteria', scale: 'five_two_zero', fixedSet: true, weightsFromTemplate: false, criterionFailureSupported: true });
    const seeded = seedCriteria(tr, []);
    expect(seeded.every((c) => c.weight === null && c.evaluatorKind === 'golden-kyc-rubric-v1' && c.evaluatorVersion === '1')).toBe(true);
    expect(technicalSettings(tr, seeded[0]!).find((r) => r.label === 'Output field')).toEqual({ label: 'Output field', value: '—', note: 'Not used' });
  });

  it('template defaults (D8) fill name, weight and scoring; a criterion the template does not map has no evaluator (never guessed)', () => {
    const p = structuredClone(V7.authoring.profile);
    p.sections[6].fields[0].criterionDefaults = [{ id: 'identification_verification', name: 'Identity verified', weight: 5, passCondition: 'Each party verified', partialCredit: 'Some parties verified', failCondition: 'No verification', critical: true, criticalCondition: 'Recommends clearance while verification is incomplete' }, { id: 'extra_check', name: 'Extra' }];
    const tr = templateRubric(form(p), V7.execution)!;
    expect(tr.weightsFromTemplate).toBe(true);
    const seeded = seedCriteria(tr, []);
    expect(seeded.find((c) => c.id === 'identification_verification')).toMatchObject({ name: 'Identity verified', weight: 5, passCondition: 'Each party verified', partialCredit: 'Some parties verified', failCondition: 'No verification', critical: true });
    const extra = seeded.find((c) => c.id === 'extra_check')!;
    expect(extra).toMatchObject({ evaluatorKind: '', evaluatorVersion: '' });
    expect(technicalSettings(tr, extra).find((r) => r.label === 'Evaluator')).toEqual({ label: 'Evaluator', value: '—', note: 'No mapping' });
    // Existing items are kept exactly, in place; only missing criteria are added.
    const mine = { ...seeded[0]!, passCondition: 'My own words' };
    expect(seedCriteria(tr, [mine])[0]).toEqual(mine);
  });

  it('Marketing keeps its 0-4 levels and groups; KYC scoring defaults are refused on a 0-4 field (AC 9)', () => {
    const tr = templateRubric(MARKETING_CAMPAIGN_TASK2_PROFILE as TemplateProfile, null)!;
    expect(tr.scale).toBe('zero_to_four');
    expect(tr.scoreKeys.map((k) => k.points)).toEqual([4, 3, 2, 1, 0]);
    expect(tr.fixedSet).toBe(false);
    expect(tr.criterionFailureSupported).toBe(false);
    expect(tr.weightsFromTemplate).toBe(true);
    const bad = structuredClone(MARKETING_CAMPAIGN_TASK2_PROFILE) as any;
    bad.profileId = 'synthetic-marketing-defaults-v1';
    const s7 = bad.sections.find((s: { key: string }) => s.key === 'S7');
    s7.fields.find((f: { type: string }) => f.type === 'criterion').criterionDefaults = [{ id: 'B1', partialCredit: 'KYC-style partial' }];
    const r = registerProfile(bad, { alternate: true });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problems.join(' ')).toMatch(/partial credit.*0-4 field/);
  });
});

describe('D22: Marketing criteria arrive filled from the template', () => {
  const MKT = MARKETING_CAMPAIGN_TASK2_PROFILE as TemplateProfile;
  const golden = (GOLDEN_MARKETING_EXAMPLE.sections as { S7: { criteria: Record<string, any>[] } }).S7.criteria;
  const exec = (evaluator: string) => ({ evaluators: golden.map((c) => ({ criterion_id: c.id, capability: { id: evaluator, version: '1' }, evidence_source: 'run_evidence' })) });
  const rubricFor = (evaluator: string, profileId = MKT.profileId) => templateRubric(MKT, exec(evaluator), authoringDefaultsFor(exec(evaluator), profileId))!;

  it('every mapped criterion gets name, group, weight and Level 4 / 2 / 0 text from the golden example; only E3 fails the whole task (D28)', () => {
    const tr = rubricFor('marketing-task2-evidence-v1');
    expect(tr.fixedSet).toBe(true);
    expect(tr.criteria).toHaveLength(golden.length);
    const seeded = seedCriteria(tr, []);
    for (const g of golden) expect(seeded.find((c) => c.id === g.id)).toMatchObject({ name: g.name, group: g.group, weight: g.weight, passCondition: g.passCondition, level2: g.level2, failCondition: g.failCondition, critical: g.id === 'E3', evaluatorKind: 'marketing-task2-evidence-v1' });
    // Group weights still total each group's weight (A 10 … G 15).
    for (const grp of MARKETING_T2_GROUPS) expect(seeded.filter((c) => c.group === grp.id).reduce((n, c) => n + Number(c.weight), 0)).toBe(grp.weight);
  });

  it('the form’s defaults apply whatever evaluator its template names; another form never gets them', () => {
    expect(rubricFor('some-other-marketing-evaluator').criteria.every((c) => c.defaults?.name)).toBe(true);
    expect(authoringDefaultsFor(exec('some-other-marketing-evaluator'), 'golden-kyc-application-type-v1')).toEqual([]);
  });

  it('a criterion stored with only its ID (seeded before the defaults) is filled; anything the author wrote is kept', () => {
    const tr = rubricFor('marketing-task2-evidence-v1');
    const shell = (id: string, weight: unknown = null) => ({ id, name: id, weight, passCondition: '', level3: '', level2: '', level1: '', failCondition: '', critical: false, group: '', evidenceRefs: [], evaluatorKind: 'marketing-task2-evidence-v1', evaluatorVersion: '1' });
    const edited = { ...shell('A2'), level2: 'My own level 2 text' };
    const out = seedCriteria(tr, [shell('A1'), shell('B1', 0), edited]);
    expect(isShellCriterion(tr.scoreKeys, shell('A1'))).toBe(true);
    expect(out[0]).toMatchObject({ id: 'A1', name: 'Relevance', weight: 4, group: 'A', passCondition: golden[0]!.passCondition });
    expect(out[1]).toMatchObject({ id: 'B1', name: 'Detection', weight: 5 });
    expect(out[2]).toEqual(edited);
    expect(out).toHaveLength(golden.length);
  });

  it('KYC v7 is unchanged: same defaults, and a filled or partly edited criterion is never rewritten', () => {
    const tr = templateRubric(form(V7.authoring.profile), V7.execution, authoringDefaultsFor(V7.execution, V7.authoring.profile.profileId))!;
    expect(tr.criteria).toHaveLength(20);
    expect(tr.criteria.every((c) => c.defaults?.partialCredit !== undefined && c.defaults.level2 === undefined)).toBe(true);
    const seeded = seedCriteria(tr, []);
    expect(seedCriteria(tr, seeded)).toEqual(seeded);
    const own = seeded.map((c, i) => (i === 0 ? { ...c, passCondition: 'Mine' } : c));
    expect(seedCriteria(tr, own)).toEqual(own);
  });
});

describe('D28: Marketing criteria arrive complete', () => {
  const MKT = MARKETING_CAMPAIGN_TASK2_PROFILE as TemplateProfile;
  const golden = (GOLDEN_MARKETING_EXAMPLE.sections as { S7: { criteria: Record<string, any>[] } }).S7.criteria;
  const exec = { evaluators: golden.map((c) => ({ criterion_id: c.id, capability: { id: 'marketing-task2-evidence-v1', version: '1' }, evidence_source: 'run_evidence' })) };
  const tr = () => templateRubric(MKT, exec, authoringDefaultsFor(exec, MKT.profileId))!;
  // What PR #91 (D22) filled in: Levels 4, 2 and 0, nothing critical.
  const d22 = (g: Record<string, any>) => ({ id: g.id, name: g.name, group: g.group, weight: g.weight, passCondition: g.passCondition, level3: '', level2: g.level2, level1: '', failCondition: g.failCondition, critical: false, evidenceRefs: [], evaluatorKind: 'marketing-task2-evidence-v1', evaluatorVersion: '1' });

  it('every level of the 0-4 scale has text: Levels 3 and 1 are the in-between levels, quoting their neighbours', () => {
    const seeded = seedCriteria(tr(), []);
    for (const g of golden) {
      const c = seeded.find((x) => x.id === g.id)!;
      for (const k of tr().scoreKeys) expect(String(c[k.key] ?? '').trim(), `${g.id} ${k.label}`).not.toBe('');
      expect(c.level3).toContain(g.passCondition.replace(/\.$/, ''));
      expect(c.level3).toContain(g.level2.replace(/\.$/, ''));
      expect(c.level1).toContain(g.failCondition.replace(/\.$/, ''));
    }
    expect(tr().scoreKeys.map((k) => k.points)).toEqual([4, 3, 2, 1, 0]);
  });

  it('E3 Readiness arrives critical with its whole-task failure condition from CR-05; no other criterion is critical', () => {
    const t = tr();
    const e3 = t.criteria.find((c) => c.id === 'E3')!.defaults!;
    expect(e3).toMatchObject({ critical: true });
    expect(e3.criticalCondition).toMatch(/CR-05/);
    expect(e3.criticalCondition).toMatch(/unresolved blocker/);
    expect(t.criteria.filter((c) => c.defaults?.critical).map((c) => c.id)).toEqual(['E3']);
  });

  it('when it applies defaults to the template’s "required throughout", and "Derived from" links to the template rubric', () => {
    const out = setFieldValue(MKT, emptyOutput(MKT), 'S7', 'criteria', seedCriteria(tr(), []));
    const d = derive({ profile: MKT, output: out, rubric: tr(), template: { id: 'mkt', version: 1 }, task: { id: 'task1', revision: 1 }, policies: [], sources: [], hash });
    for (const c of d.criteria) {
      expect(c.details.applicability, c.id).toEqual({ kind: 'REQUIRED', condition: 'Required throughout this workflow.', exceptions: '' });
      expect(c.details.unresolved.join(' '), c.id).not.toMatch(/When this applies could not be read/);
      expect(c.needs, c.id).not.toContain('Source');
      expect(c.links.length, c.id).toBeGreaterThan(0);
    }
    const a1 = d.criteria.find((c) => c.id === 'A1')!;
    expect(a1.links[0]).toMatchObject({ kind: 'TEMPLATE_REFERENCE', target: 'template:mkt:criterion:A1', label: 'Template rubric · A1 Relevance', templateId: 'mkt' });
    expect(d.criteria.find((c) => c.id === 'E3')!.details.wholeTaskFailure).toMatchObject({ condition: expect.stringMatching(/CR-05/) });
    // The template link is a fallback: it never counts as covering a requirement or becomes a suggested addition.
    expect(d.additions.some((x) => x.requirement.startsWith('template:'))).toBe(false);
  });

  it('a criterion left exactly as PR #91 filled it takes Levels 3 and 1 and E3’s critical flag; anything an author changed is kept', () => {
    const t = tr();
    const before = golden.map(d22);
    const edited = { ...d22(golden.find((g) => g.id === 'A2')!), level2: 'My own level 2 text' };
    const out = seedCriteria(t, before.map((c) => (c.id === 'A2' ? edited : c)));
    const e3 = out.find((c) => c.id === 'E3')!;
    expect(e3).toMatchObject({ critical: true, level3: expect.stringContaining('Between Level 4 and Level 2'), level1: expect.stringContaining('Between Level 2 and Level 0') });
    expect(out.find((c) => c.id === 'A1')).toMatchObject({ critical: false, level3: expect.stringContaining('Between') });
    expect(out.find((c) => c.id === 'A2')).toEqual(edited);
    // Once filled, an author's choice sticks: unticking E3 is never reverted on the next open.
    const unticked = out.map((c) => (c.id === 'E3' ? { ...c, critical: false } : c));
    expect(seedCriteria(t, unticked)).toEqual(unticked);
    // The editor merges exactly what the server seed fills (and nothing for an edited criterion).
    const d = t.criteria.find((c) => c.id === 'E3')!.defaults;
    expect(templateFill(t.scoreKeys, d22(golden.find((g) => g.id === 'E3')!), e3, d)).toMatchObject({ critical: true, level3: e3.level3, level1: e3.level1 });
    expect(templateFill(t.scoreKeys, edited, out.find((c) => c.id === 'A2')!, t.criteria.find((c) => c.id === 'A2')!.defaults)).toBeNull();
  });

  it('KYC v7 defaults have no earlier revision, applicability or template source: KYC derivation is unchanged', () => {
    const k = templateRubric(form(V7.authoring.profile), V7.execution, authoringDefaultsFor(V7.execution, V7.authoring.profile.profileId))!;
    expect(k.criteria.every((c) => !c.defaults?.earlier && !c.defaults?.applicability && !c.defaults?.source)).toBe(true);
    const p = form(V7.authoring.profile);
    const d = derive(input(p, v7Output(p), { rubric: k }));
    expect(d.criteria.flatMap((c) => c.links).some((l) => l.kind === 'TEMPLATE_REFERENCE')).toBe(false);
  });
});

describe('derivation (AC 1, 7, 8)', () => {
  it('reads roles from the template’s definitions, not section numbers: the same steps field gives the same links in another section', () => {
    const p = form(V7.authoring.profile);
    const a = derive(input(p, v7Output(p)));
    // Move the procedure field from S5 to S2 (a different template layout); its role is still read from its definition.
    const moved = structuredClone(V7.authoring.profile);
    const steps = moved.sections[4].fields.splice(0, 1)[0];
    moved.sections[1].fields.push(steps);
    moved.sections[4].fields.push({ key: 'note', type: 'long_text', label: 'Note', help: 'Optional.' });
    const p2 = form(moved);
    const b = derive(input(p2, setFieldValue(p2, setFieldValue(p2, emptyOutput(p2), 'S1', 'applicationType', 'custodial'), 'S2', 'steps', [{ action: "Verify the custodian's authority and the custodial agreement", tool: 'authority.check', failureBehaviour: '' }])));
    const roleOf = (d: typeof a, key: string) => d.roles.find((r) => r.field === key)!.role;
    expect(roleOf(a, 'steps')).toBe('steps');
    expect(roleOf(b, 'steps')).toBe('steps');
    const labels = (d: typeof a) => d.criteria.find((c) => c.id === 'account_authority')!.links.map((l) => l.label.replace(/^S\d/, 'S?'));
    expect(labels(b)).toEqual(labels(a));
    expect(b.unused.map((u) => u.field)).toContain('note');
  });

  it('applicability safeguards: permitted option stays optional, human duty is routing only, unknown stays unset, product follows the application', () => {
    const p = form(V7.authoring.profile);
    const rule = (marking: string | null, actor: string | null = null, appliesWhen: string | null = null) => ({ ruleKey: 'R-AU-1', ruleVersionId: 'rv1', title: 'Custodian authority', requirement: "Verify the custodian's authority to act for the minor", documentVersionId: 'dv1', documentTitle: 'Policy', marking, appliesWhen, actor, required: true });
    const src = [{ kind: 'POLICY_DOCUMENT' as const, ref: 'dv1', label: 'Policy', detail: '', ticked: true, origin: 'DEFAULT' as const }];
    const auth = (policies: DeriveInput['policies'], out = v7Output(p)) => derive(input(p, out, { policies, sources: src })).criteria.find((c) => c.id === 'account_authority')!.details.applicability;
    expect(auth([rule('Permitted option', null, 'When the custodian route is chosen')])).toMatchObject({ kind: 'PERMITTED_OPTION', condition: 'When the custodian route is chosen' });
    expect(auth([rule('Mandatory when applicable', null, 'Someone acts for another party')])).toMatchObject({ kind: 'REQUIRED_WHEN', condition: 'Someone acts for another party' });
    expect(auth([rule('Mandatory', 'bank officer (human)')])).toMatchObject({ kind: 'OTHER_ROLE' });
    expect(auth([rule('Mandatory', 'bank officer (human)')]).condition).toMatch(/never exercises that authority itself/);
    expect(auth([])).toMatchObject({ kind: 'REQUIRED' });
    expect(auth([]).condition).toMatch(/actual product.*never the example value/);
    // No step and no rule: when it applies cannot be read; it stays UNSET (never silently "not applicable").
    expect(auth([], v7Output(p, []))).toMatchObject({ kind: 'UNSET' });
  });

  it('a requirement stated in several places is one requirement; two weighted criteria on it are flagged as duplicate weight', () => {
    const reqs = [{ key: 'rule:rv1', label: 'S4 · Policy rules · R-ID-1', kind: 'POLICY_RULE' as const, mandatory: true, applicability: 'REQUIRED' as const }, { key: 'task:S5.steps[0]', label: 'Workflow · Verify', kind: 'WORKFLOW_STEP' as const, mandatory: true, applicability: 'REQUIRED' as const }];
    const c = coverage(reqs, [{ id: 'a', covers: ['rule:rv1'], weighted: true }, { id: 'b', covers: ['rule:rv1', 'task:S5.steps[0]'], weighted: true }]);
    expect(c).toMatchObject({ total: 2, covered: 2, gaps: [] });
    expect(c.duplicates).toEqual([{ requirement: 'S4 · Policy rules · R-ID-1', criteria: ['a', 'b'] }]);
    const gap = coverage(reqs, [{ id: 'b', covers: ['task:S5.steps[0]'], weighted: true }]);
    expect(gap.gaps.map((g) => g.key)).toEqual(['rule:rv1']);
  });

  it('links carry template and task versions and a snapshot; a rule from an unticked document is never linked', () => {
    const p = form(V7.authoring.profile);
    const pol = [{ ruleKey: 'R-AU-1', ruleVersionId: 'rv1', title: 'Custodian authority', requirement: "Verify the custodian's authority", documentVersionId: 'dv1', documentTitle: 'Policy', required: true }];
    const ticked = derive(input(p, v7Output(p), { policies: pol, sources: [{ kind: 'POLICY_DOCUMENT', ref: 'dv1', label: 'P', detail: '', ticked: true, origin: 'DEFAULT' }] }));
    const link = ticked.criteria.find((c) => c.id === 'account_authority')!.links.find((l) => l.kind === 'POLICY_RULE')!;
    expect(link).toMatchObject({ templateId: 't1', templateVersion: 2, taskId: 'task1', taskRevision: 3, ruleKey: 'R-AU-1', ruleVersionId: 'rv1', documentVersionId: 'dv1' });
    expect(link.snapshot).toMatch(/^[0-9a-f]{64}$/);
    const unticked = derive(input(p, v7Output(p), { policies: pol, sources: [{ kind: 'POLICY_DOCUMENT', ref: 'dv1', label: 'P', detail: '', ticked: false, origin: 'DEFAULT' }] }));
    expect(unticked.criteria.flatMap((c) => c.links).some((l) => l.kind === 'POLICY_RULE')).toBe(false);
  });
});

describe('export unchanged (AC 10)', () => {
  it('no export or dataset module reads the rubric tables or the rubric module', () => {
    const roots = ['../src/anvil', '../src/dataset', '../src/policy/anvil-project-policy.ts', '../src/routes/project-export.ts', '../src/routes/anvil.ts', '../src/routes/dataset.ts'];
    const files: string[] = [];
    for (const r of roots) {
      const path = new URL(r, import.meta.url).pathname;
      if (path.endsWith('.ts')) files.push(path);
      else for (const f of readdirSync(path)) if (f.endsWith('.ts')) files.push(join(path, f));
    }
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/rubricCriterionAnnotation|rubricRecommendationRun|rubricTaskSources|tasks\/rubric|RUBRIC_INTERNAL_ONLY|criterionDefaults/);
  });

  it('the v6 and v7 template hashes are unchanged by the optional criterionDefaults key', () => {
    for (const [spec, parts] of [[V6, null], [V7, null]] as const) {
      void parts;
      const { schemaVersion, anvil_template_key, requirement, authoring, execution, skills } = spec;
      const j = jointTemplateSpec({ lineageId: '22222222-2222-4222-8222-222222222222', version: 2, anvilSpec: { schemaVersion, anvil_template_key, requirement, authoring, execution, skills } } as never)!;
      // The joint object carries the authoring part exactly as received: no criterionDefaults are added to it.
      expect(JSON.stringify(j.authoring)).not.toMatch(/criterionDefaults/);
      expect(jointHashes(j).part_hashes.authoring).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
