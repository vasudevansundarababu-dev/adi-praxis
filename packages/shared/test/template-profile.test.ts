import { describe, expect, it } from 'vitest';
import {
  addRepeatedItem,
  agentProjection,
  checkProfile,
  compileKycContract,
  compilePraxisContract,
  emptyOutput,
  exportStatusLine,
  getFieldValue,
  isBlankOutput,
  itemFieldsOf,
  KYC_EXAMPLE_TASK,
  KYC_PROFILE,
  kycChecks,
  praxisContractIssues,
  profileForWorkflow,
  profileProblems,
  profileShapeProblems,
  registerProfile,
  removeRepeatedItem,
  sampleProfileOutput,
  sectionProgress,
  setFieldValue,
  startProfileOutput,
  TEMPLATE_PROFILES,
  WAVE1_PROFILES,
  WAVE2_PROFILES,
  type KycTask,
  type TemplateProfile,
} from '../src';

const NON_KYC = TEMPLATE_PROFILES.filter((p) => p.storage === 'sections');
const ids = { taskId: '3f0c1d2e-0000-4000-8000-000000000001', revisionId: '3f0c1d2e-0000-4000-8000-000000000001-r4' };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The KYC example with typed criterion bindings (the additive extension used by the Anvil compiler). */
export const KYC_BOUND: KycTask = {
  ...clone(KYC_EXAMPLE_TASK),
  rubric: {
    ...clone(KYC_EXAMPLE_TASK.rubric!),
    criteria: [
      { id: 'C1', name: 'Escalates instead of approving', weight: 60, passCondition: 'Final disposition is ESCALATE', critical: true, outputField: 'disposition', comparison: 'json_equals', expectedValue: 'ESCALATE' },
      { id: 'C2', name: 'Rates the case high risk', weight: 40, passCondition: 'Risk rating is HIGH', outputField: 'risk_rating', comparison: 'json_equals', expectedValue: 'HIGH' },
    ],
    commonErrors: [{ description: 'Approving despite layered ownership', caughtBy: 'C1' }],
  },
};

describe('template profile registry', () => {
  it('registers all five Wave 1 profiles, matched by catalogue name', () => {
    for (const p of WAVE1_PROFILES) {
      expect(checkProfile(p), p.profileId).toEqual([]);
      const found = profileForWorkflow(p.catalogWorkflowName);
      expect(found.status).toBe('ok');
      expect(found.status === 'ok' && found.profile.profileId).toBe(p.profileId);
      expect(p.agentMode).toBe('SINGLE');
      expect(p.sections.map((s) => s.key)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    }
    expect(profileForWorkflow('launch of noise cancelling phone').status).toBe('ok');
    expect(profileForWorkflow('Omnichannel Creative & Locale Compliance').status).toBe('ok');
    expect(profileForWorkflow('Compliance monitoring').status).toBe('none');
    expect(KYC_PROFILE.domainPlugin).toBe('kyc-workbench');
    expect(KYC_PROFILE.contractStatus).toBe('confirmed');
    for (const p of NON_KYC) expect(p.contractStatus).toBe('requires_confirmation');
  });

  it('registers the three Wave 2 profiles with their draft pick lists as typed S6 output fields', () => {
    const s6 = (p: TemplateProfile) => Object.fromEntries(p.sections[5]!.fields.filter((f) => f.outputField).map((f) => [f.outputField, f.options!.map((o) => o.value)]));
    expect(WAVE2_PROFILES.map((p) => [p.catalogWorkflowName, p.templateId])).toEqual([['Adverse media review', 'BK03'], ['Enhanced due diligence', 'BK10'], ['Customer risk rating', 'BK09']]);
    for (const p of WAVE2_PROFILES) {
      expect(checkProfile(p), p.profileId).toEqual([]);
      expect(profileForWorkflow(p.catalogWorkflowName)).toMatchObject({ status: 'ok', profile: { profileId: p.profileId } });
      expect(p).toMatchObject({ agentMode: 'SINGLE', storage: 'sections', contractStatus: 'requires_confirmation', domainPlugin: null });
      // Reference values and the rubric are private.
      for (const f of p.sections[5]!.fields.filter((x) => x.outputField)) expect(f.visibility, `${p.profileId} S6.${f.key}`).toBe('private_reference');
      expect(itemFieldsOf(p.sections[5]!.fields.find((f) => f.key === 'decisionFields')!).find((f) => f.key === 'referenceValue')!.visibility).toBe('private_reference');
      for (const f of p.sections[6]!.fields) expect(f.visibility, `${p.profileId} S7.${f.key}`).toBe('private_rubric');
    }
    const [adverse, edd, crr] = WAVE2_PROFILES;
    expect(s6(adverse)).toEqual({ match: ['confirmed', 'possible', 'false_positive', 'unresolved'], recommendation: ['close', 'escalate', 'request_information'] });
    expect(s6(edd)).toEqual({ recommendation: ['proceed_for_approval', 'request_information', 'escalate', 'recommend_decline'] });
    expect(s6(crr)).toEqual({ risk: ['low', 'medium', 'high', 'undetermined'], override: ['none', 'proposed_increase', 'proposed_decrease'] });
    // Template deliverables (S5) from each draft.
    const s5 = (p: TemplateProfile) => p.sections[4]!.fields.map((f) => f.key);
    expect(s5(adverse)).toEqual(expect.arrayContaining(['identityMatch', 'sourceReliability', 'allegationsVsFacts', 'relevance']));
    expect(s5(edd)).toEqual(expect.arrayContaining(['enhancedChecks', 'evidenceGaps', 'riskAssessment', 'humanHandoff']));
    expect(s5(crr)).toEqual(expect.arrayContaining(['factorAssessments', 'calculation', 'overrideRationale']));
  });

  it('Wave 2 conditional and template rules: EDD hand-off and finding evidence status, CRR override rationale', () => {
    const [, edd, crr] = WAVE2_PROFILES;
    const eddProblems = profileProblems(edd, setFieldValue(edd, sampleProfileOutput(edd), 'S5', 'humanHandoff', ''));
    expect(eddProblems).toContainEqual(expect.objectContaining({ path: 'S5.humanHandoff', kind: 'required' }));
    const findings = getFieldValue(edd, sampleProfileOutput(edd), 'S5', { key: 'findings' }) as Record<string, unknown>[];
    expect(findings[0]!.evidenceStatus).toBe('verified');
    const badStatus = profileProblems(edd, setFieldValue(edd, sampleProfileOutput(edd), 'S5', 'findings', [{ ...findings[0], evidenceStatus: 'probable' }]));
    expect(badStatus).toContainEqual(expect.objectContaining({ path: 'S5.findings[0].evidenceStatus', kind: 'invalid' }));
    let out = setFieldValue(crr, sampleProfileOutput(crr), 'S5', 'overrideRationale', '');
    expect(profileProblems(crr, out).some((x) => x.path === 'S5.overrideRationale')).toBe(false);
    out = setFieldValue(crr, out, 'S6', 'override', 'proposed_increase');
    expect(profileProblems(crr, out)).toContainEqual(expect.objectContaining({ path: 'S5.overrideRationale', kind: 'conditional' }));
  });

  const base = (): TemplateProfile => clone(NON_KYC[0]!);
  const bad = (mutate: (p: Record<string, any>) => void, name: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const p = base() as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    p.catalogWorkflowName = name;
    mutate(p);
    return p;
  };

  it('rejects unknown field types, duplicate keys, empty sections and pick lists without options', () => {
    const unknown = bad((p) => p.sections[1].fields.push({ key: 'sig', type: 'signature_pad', label: 'Sign', help: 'x' }), 'Test unknown type');
    expect(checkProfile(unknown).join()).toMatch(/S2\.sig: unsupported field type "signature_pad"/);
    const dup = bad((p) => p.sections[2].fields.push({ ...p.sections[0].fields[0] }), 'Test duplicate');
    expect(checkProfile(dup).join()).toMatch(/S3\.title: duplicate field key/);
    const empty = bad((p) => (p.sections[3].fields = []), 'Test empty section');
    expect(checkProfile(empty).join()).toMatch(/S4: section has no fields/);
    const noOptions = bad((p) => p.sections[5].fields.push({ key: 'x', type: 'pick_list', label: 'X', help: 'x', options: [] }), 'Test pick list');
    expect(checkProfile(noOptions).join()).toMatch(/S6\.x: pick list has no options/);
    const badCondition = bad((p) => (p.sections[0].fields[1].required = { anyOf: [{ field: 'S9.nope', equals: 'a' }] }), 'Test condition');
    expect(checkProfile(badCondition).join()).toMatch(/condition refers to unknown field/);
  });

  it('an unsupported profile is a diagnostic, never a blank form', () => {
    const unknown = bad((p) => p.sections[1].fields.push({ key: 'sig', type: 'signature_pad', label: 'Sign', help: 'x' }), 'Unsupported Workflow X');
    const r = registerProfile(unknown);
    expect(r.ok).toBe(false);
    const found = profileForWorkflow('Unsupported Workflow X');
    expect(found.status).toBe('unsupported');
    expect(found.status === 'unsupported' && found.problems[0]).toMatch(/unsupported field type/);
  });
});

describe('profile helpers', () => {
  it.each(NON_KYC.map((p) => [p.profileId, p] as const))('%s: every required field is reported when empty', (_id, p) => {
    const out = emptyOutput(p);
    const problems = profileProblems(p, out);
    for (const s of p.sections)
      for (const f of s.fields.filter((x) => x.required === true)) expect(problems.some((x) => x.path === `${s.key}.${f.key}` && x.kind === 'required'), `${s.key}.${f.key}`).toBe(true);
    // Empty output: every required field counted, none done.
    for (const sp of sectionProgress(p, out)) expect(sp.done).toBe(0);
    expect(profileShapeProblems(p, out)).toEqual([]);
  });

  it.each(NON_KYC.map((p) => [p.profileId, p] as const))('%s: a complete sample has no problems and full progress', (_id, p) => {
    const out = sampleProfileOutput(p);
    expect(profileProblems(p, out)).toEqual([]);
    for (const sp of sectionProgress(p, out)) expect(sp.done).toBe(sp.required);
    expect(profileShapeProblems(p, out)).toEqual([]);
  });

  it('reports required item fields and conditional rules with precise paths', () => {
    const p = NON_KYC[0]!;
    let out = addRepeatedItem(p, emptyOutput(p), 'S2', 'evidence');
    expect((getFieldValue(p, out, 'S2', { key: 'evidence' }) as { id: string }[])[0]!.id).toBe('E1');
    const problems = profileProblems(p, out);
    expect(problems.find((x) => x.path === 'S2.evidence[0].content')?.kind).toBe('required');
    expect(problems.some((x) => x.path === 'S3.tools')).toBe(false);
    out = setFieldValue(p, out, 'S3', 'environment', 'recorded_tools');
    expect(profileProblems(p, out).find((x) => x.path === 'S3.tools')?.kind).toBe('conditional');
    out = removeRepeatedItem(p, out, 'S2', 'evidence', 0);
    expect(getFieldValue(p, out, 'S2', { key: 'evidence' })).toEqual([]);
  });

  it('keeps header.title in sync with the S1 title', () => {
    const p = NON_KYC[0]!;
    const out = setFieldValue(p, emptyOutput(p), 'S1', 'title', 'A case');
    expect((out.header as { title: string }).title).toBe('A case');
    expect(profileShapeProblems(p, { ...out, header: { title: 'Other' } })).toContain('header.title must equal sections.S1.title');
    expect(profileShapeProblems(p, { ...out, profile: { id: p.profileId, version: 9 } }).join()).toMatch(/not supported/);
  });

  it.each(NON_KYC.map((p) => [p.profileId, p] as const))('%s: agent projection removes every private field', (_id, p) => {
    const out = sampleProfileOutput(p);
    const proj = agentProjection(p, out)!;
    const text = JSON.stringify(proj);
    expect(text).not.toContain('PRIVATE-');
    expect(text).not.toContain('referenceValue');
    expect(text).toContain('Content (synthetic sample)');
    expect(Object.keys(proj.sections as object)).not.toContain('S7');
  });

  it('KYC: the profile mirrors kycChecks and its projection drops defects, solution and rubric', () => {
    expect(profileProblems(KYC_PROFILE, KYC_EXAMPLE_TASK)).toEqual([]);
    const empty = profileProblems(KYC_PROFILE, {});
    const failing = kycChecks({}, null).filter((c) => !c.ok).length;
    expect(failing).toBeGreaterThan(0);
    for (const path of ['S1.title', 'S1.trigger', 'S2.parties', 'S2.documents', 'S3.tools', 'S5.steps', 'S5.findings', 'S6.disposition', 'S6.riskRating', 'S7.criteria', 'S7.commonErrors']) expect(empty.some((x) => x.path === path), path).toBe(true);
    const approve = { ...clone(KYC_EXAMPLE_TASK), solution: { ...clone(KYC_EXAMPLE_TASK.solution!), disposition: 'RECOMMEND_APPROVE', humanHandoff: '' } };
    expect(profileProblems(KYC_PROFILE, approve).find((x) => x.path === 'S5.humanHandoff')?.kind).toBe('conditional');
    const proj = agentProjection(KYC_PROFILE, KYC_EXAMPLE_TASK)!;
    const text = JSON.stringify(proj);
    expect(text).toContain('Northwind Trading Ltd');
    expect(text).not.toContain('Stale: the latest filing');
    expect(proj).not.toHaveProperty('solution');
    expect(proj).not.toHaveProperty('rubric');
    expect((proj.environment as Record<string, unknown>).responses).toBeUndefined();
    expect(sectionProgress(KYC_PROFILE, KYC_EXAMPLE_TASK).every((s) => s.done === s.required)).toBe(true);
  });

  it('legacy outputs (no profile key) are untouched by the helpers', () => {
    const legacy = { header: { title: 'Old task', coverageTags: { a: 'b' } }, body: 'Free text written before profiles' };
    const before = clone(legacy);
    for (const p of NON_KYC) {
      expect(profileProblems(p, legacy)).toEqual([]);
      expect(agentProjection(p, legacy)).toBeNull();
      expect(sectionProgress(p, legacy).every((s) => s.done === 0)).toBe(true);
      expect(compilePraxisContract(p, legacy, ids)).toEqual({ blockers: [expect.objectContaining({ code: 'PROFILE_NOT_APPLICABLE' })] });
    }
    expect(legacy).toEqual(before);
    expect(isBlankOutput(legacy)).toBe(false);
    expect(isBlankOutput({ header: {} })).toBe(true);
    expect(isBlankOutput(null)).toBe(true);
    const started = startProfileOutput(NON_KYC[0]!, { header: { title: 'Kept', edgeCase: 'Edge' } });
    expect(started.header).toEqual({ title: 'Kept', edgeCase: 'Edge' });
    expect(getFieldValue(NON_KYC[0]!, started, 'S1', { key: 'title' })).toBe('Kept');
  });

  it('structured primitives expose their built-in item fields', () => {
    expect(itemFieldsOf({ key: 'c', type: 'criterion', label: 'C', help: 'h' }).map((f) => f.key)).toEqual(expect.arrayContaining(['id', 'name', 'weight', 'passCondition', 'critical', 'outputField', 'comparison', 'expectedValue']));
    expect(itemFieldsOf({ key: 'p', type: 'policy_citation', label: 'P', help: 'h' }).filter((f) => f.visibility === 'private_reference').map((f) => f.key)).toContain('rationale');
  });
});

describe('Anvil contract compiler (praxis.anvil.task.v1)', () => {
  it.each(NON_KYC.map((p) => [p.profileId, p] as const))('%s: a fully filled output compiles with zero contract issues', (_id, p) => {
    const r = compilePraxisContract(p, sampleProfileOutput(p), ids);
    if (!('contract' in r)) throw new Error(JSON.stringify(r.blockers));
    expect(praxisContractIssues(r.contract)).toEqual([]);
    const c = r.contract;
    expect(c.environment.binding).toBe('structured-decision-v1');
    expect(c.stages).toHaveLength(1);
    expect(c.deliverables[0]!.path).toBe('output.json');
    expect(c.provenance.classification).toBe('synthetic');
    expect(c.rubric.criteria.reduce((n, x) => n + x.weight_bps, 0)).toBe(10000);
    expect(c.constraints[0]).toMatchObject({ id: 'policy-PR1', hard_failure: true, binding: { kind: 'json_number_max', field: 'gap_count', value: 5 } });
    expect(c.rubric.reference_output.gap_count).toBe(2);
    // Private material is never actor evidence.
    expect(JSON.stringify(c.evidence.filter((e) => e.visibility === 'actor'))).not.toContain('PRIVATE-');
    expect(c.evidence.some((e) => e.visibility === 'private')).toBe(true);
    // Deterministic.
    expect(compilePraxisContract(p, sampleProfileOutput(p), ids)).toEqual(r);
  });

  it.each(NON_KYC.map((p) => [p.profileId, p] as const))('%s: a missing reference value yields a precise blocker', (_id, p) => {
    const outcome = p.sections[5]!.fields.find((f) => f.outputField)!;
    const out = setFieldValue(p, sampleProfileOutput(p), 'S6', outcome.key, '');
    const r = compilePraxisContract(p, out, ids);
    expect(r).not.toHaveProperty('contract');
    expect('blockers' in r && r.blockers).toContainEqual(expect.objectContaining({ code: 'MISSING_REFERENCE', path: `S6.${outcome.key}` }));
    const df = getFieldValue(p, sampleProfileOutput(p), 'S6', { key: 'decisionFields' }) as Record<string, unknown>[];
    const r2 = compilePraxisContract(p, setFieldValue(p, sampleProfileOutput(p), 'S6', 'decisionFields', [{ ...df[0], referenceValue: '' }]), ids);
    expect('blockers' in r2 && r2.blockers).toContainEqual(expect.objectContaining({ code: 'MISSING_REFERENCE', path: 'S6.decisionFields[0].referenceValue' }));
  });

  it('blocks unbound criteria, wrong weights and references that fail their own rule', () => {
    const p = NON_KYC[1]!;
    const crit = (getFieldValue(p, sampleProfileOutput(p), 'S7', { key: 'criteria' }) as Record<string, unknown>[])[0]!;
    const blockers = (c: Record<string, unknown>[]) => {
      const r = compilePraxisContract(p, setFieldValue(p, sampleProfileOutput(p), 'S7', 'criteria', c), ids);
      return 'blockers' in r ? r.blockers.map((b) => `${b.code}@${b.path}`) : [];
    };
    expect(blockers([{ ...crit, outputField: '' }])).toContain('MISSING_BINDING@S7.criteria[0].outputField');
    expect(blockers([{ ...crit, outputField: 'nope' }])).toContain('UNKNOWN_OUTPUT_FIELD@S7.criteria[0].outputField');
    expect(blockers([{ ...crit, weight: 60 }])).toContain('WEIGHTS@criteria');
    expect(blockers([{ ...crit, expectedValue: 'not-an-option' }])).toContain('INVALID_VALUE@S7.criteria[0].expectedValue');
    const other = p.sections[5]!.fields.find((f) => f.outputField)!.options![1]!.value;
    expect(blockers([{ ...crit, expectedValue: other }])).toContain('REFERENCE_FAILS_RULE@S7.criteria[0]');
  });

  it('export status reads "Approved; export adapter blocked: <reason>"', () => {
    expect(exportStatusLine('Approved', { status: 'blocked', blockers: [{ code: 'MISSING_BINDING', path: 'rubric.criteria[0].outputField', message: 'Name the output field' }, { code: 'X', path: 'y', message: 'z' }] })).toBe('Approved; export adapter blocked: Name the output field (rubric.criteria[0].outputField) and 1 more');
    expect(exportStatusLine('Submitted', { status: 'ready', blockers: [] })).toBe('Submitted; export adapter ready (praxis.anvil.task.v1)');
    expect(exportStatusLine('Approved', null)).toBeNull();
  });

  it('KYC: the workbench output compiles; criteria without a binding block with their path', () => {
    const r = compileKycContract(KYC_BOUND, ids);
    if (!('contract' in r)) throw new Error(JSON.stringify(r.blockers));
    expect(praxisContractIssues(r.contract)).toEqual([]);
    expect(r.contract.rubric.reference_output).toEqual({ disposition: 'ESCALATE', risk_rating: 'HIGH' });
    expect(JSON.stringify(r.contract.evidence.filter((e) => e.visibility === 'actor'))).not.toContain('Stale: the latest filing');
    expect(compilePraxisContract(KYC_PROFILE, KYC_BOUND, ids)).toEqual(r);
    const unbound = compileKycContract(KYC_EXAMPLE_TASK, ids);
    expect('blockers' in unbound && unbound.blockers[0]).toMatchObject({ code: 'MISSING_BINDING', path: 'rubric.criteria[0].outputField' });
    const noRef = compileKycContract({ ...KYC_BOUND, solution: { ...KYC_BOUND.solution, riskRating: undefined } }, ids);
    expect('blockers' in noRef && noRef.blockers).toContainEqual(expect.objectContaining({ code: 'MISSING_REFERENCE', path: 'solution.riskRating' }));
  });
});
