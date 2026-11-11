import { describe, expect, it } from 'vitest';
import { emptyOutput, planNextQuestion, profileForWorkflow, profileProblems, sampleProfileOutput, type TemplateProfile } from '../src/template-profile';

const profile = (name: string): TemplateProfile => {
  const l = profileForWorkflow(name);
  if (l.status !== 'ok') throw new Error(`no profile for ${name}`);
  return l.profile;
};

describe('Wave 2 template-aware question planner', () => {
  const kyb = profile('KYB and beneficial ownership');

  it('asks for the first missing required field, by its label and help, in the SME\'s own words', () => {
    const q = planNextQuestion(kyb, emptyOutput(kyb))!;
    expect(q.section).toBe('S1');
    const field = kyb.sections[0]!.fields.find((f) => f.key === q.field)!;
    expect(q.question).toContain(field.label);
    expect(q.question).toMatch(/in your own words/);
  });

  it('follows the topic of the latest answer, so a correction about evidence is followed through', () => {
    const q = planNextQuestion(kyb, emptyOutput(kyb), 'I need to fix the ownership evidence for the second party')!;
    expect(q.section).toBe('S2');
    expect(planNextQuestion(kyb, emptyOutput(kyb), 'the rubric weights are wrong')!.section).toBe('S7');
  });

  it('asks nothing once every required field is written, and never for another template\'s output', () => {
    const done = sampleProfileOutput(kyb);
    expect(profileProblems(kyb, done).filter((p) => p.kind !== 'invalid')).toEqual([]);
    expect(planNextQuestion(kyb, done)).toBeNull();
    const aml = profile('AML transaction-monitoring alerts');
    expect(planNextQuestion(aml, emptyOutput(kyb))).toBeNull();
  });

  it('never includes field examples (they teach structure, not the assigned case)', () => {
    for (const p of [kyb, profile('AML transaction-monitoring alerts'), profile('Omnichannel Creative & Locale Compliance')]) {
      const q = planNextQuestion(p, emptyOutput(p))!;
      const field = p.sections.flatMap((s) => s.fields).find((f) => f.key === q.field)!;
      if (field.example) expect(q.question).not.toContain(field.example.slice(0, 40));
    }
  });
});
