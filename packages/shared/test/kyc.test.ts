import { describe, expect, it } from 'vitest';
import { KYC_EXAMPLE_TASK, kycChecks, kycKeyInputs, syntheticGenerator, type KycTask } from '../src';

const clone = (): KycTask => structuredClone(KYC_EXAMPLE_TASK);
const failing = (t: KycTask, slot: { edgeCase: string | null; isOpen: boolean } | null = null) =>
  kycChecks(t, slot).filter((c) => !c.ok && c.severity !== 'warning').map((c) => c.id);

describe('KYC task checks (TASK-KYC section 5)', () => {
  it('the section 6 example passes every check, including its edge case', () => {
    expect(failing(clone(), { edgeCase: 'Complex or circular ownership', isOpen: false })).toEqual([]);
  });

  it('an empty draft fails with each problem mapped to its workbench section', () => {
    const checks = kycChecks({}, null);
    const sections = new Set(checks.filter((c) => !c.ok).map((c) => c.section));
    expect([...sections].sort()).toEqual(['W01', 'W02', 'W03', 'W04', 'W05']);
  });

  it('a disposition that approves or rejects without escalation fails the human-gate check', () => {
    const t = clone();
    t.solution!.disposition = 'RECOMMEND_APPROVE';
    t.solution!.riskRating = 'MEDIUM';
    t.solution!.humanHandoff = '';
    expect(failing(t)).toEqual(['human-gate']);
    t.solution!.humanHandoff = 'Send to the approver with findings; the agent does not decide.';
    expect(failing(t)).toEqual([]);
    // A high-risk classification is also a human decision.
    t.solution!.disposition = 'REQUEST_INFORMATION';
    t.solution!.riskRating = 'HIGH';
    t.solution!.humanHandoff = '';
    expect(failing(t)).toEqual(['human-gate']);
  });

  it('weights must sum to 100, with a critical criterion and failure modes caught by the rubric', () => {
    const t = clone();
    t.rubric!.criteria![0]!.weight = 30;
    t.rubric!.criteria!.forEach((c) => (c.critical = false));
    t.rubric!.commonErrors![0]!.caughtBy = 'C9';
    expect(failing(t).sort()).toEqual(['rubric.critical', 'rubric.failure-modes', 'rubric.weights']);
  });

  it('findings must cite evidence in the task and every tool step needs a defined response (replayable)', () => {
    const t = clone();
    t.solution!.findings![0]!.evidenceRefs = ['D99'];
    t.solution!.steps![0]!.responseId = 'R2'; // a screening response on a registry step
    expect(failing(t).sort()).toEqual(['findings.cite', 'steps.responses']);
  });

  it('ownership must total 100% per layer, dependencies cannot loop, and document dates must be in order', () => {
    const t = clone();
    t.customerFile!.ownership![1]!.percent = 30;
    t.solution!.steps![0]!.dependsOn = ['S7'];
    t.evidence!.documents![0]!.expiryDate = '2014-01-01';
    expect(failing(t).sort()).toEqual(['documents.dates', 'ownership.totals', 'steps.dependencies']);
  });

  it('difficulty 3 or more needs at least six trajectory steps', () => {
    const t = clone();
    t.solution!.steps = t.solution!.steps!.slice(0, 5).map((s) => ({ ...s, dependsOn: [] }));
    expect(failing(t)).toContain('steps.count');
    t.header!.difficulty = 2;
    expect(failing(t)).not.toContain('steps.count');
  });

  it('the slot’s edge case must appear in the case (coverage-tag match)', () => {
    expect(failing(clone(), { edgeCase: 'Expired or damaged ID', isOpen: false })).toEqual(['coverage.edge-present']);
    expect(failing(clone(), { edgeCase: 'Sanctions near-match', isOpen: false })).toEqual([]);
    expect(failing(clone(), { edgeCase: 'PEP link', isOpen: false })).toEqual(['coverage.edge-present']);
  });

  it('key inputs summarise the structure for duplicate detection', () => {
    expect(kycKeyInputs(clone())).toEqual(expect.arrayContaining(['customer:corporate', 'disposition:escalate', 'resp:sanctions_pep_screening:near_match']));
  });
});

describe('synthetic generator', () => {
  it('is deterministic per seed and uses clearly fictitious formats', () => {
    const a = syntheticGenerator('seed-1');
    const b = syntheticGenerator('seed-1');
    expect(a.personName()).toBe(b.personName());
    const g = syntheticGenerator('x');
    expect(g.passportNumber()).toMatch(/^SYN-P\d{7}$/);
    expect(g.companyNumber()).toMatch(/^SYN-\d{6}$/);
    expect(g.phone()).toMatch(/^07700 900\d{3}$/);
    expect(g.email('Ada Arkwright')).toBe('ada.arkwright@example.test');
    expect(g.dateOfBirth()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
