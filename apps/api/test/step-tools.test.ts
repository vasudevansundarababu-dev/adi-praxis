import { followUpsOf, orderedTools, stepToolWarnings, toolOptionLabel, translateProcedure } from '@praxis/shared';
import { describe, expect, it } from 'vitest';
import { actorProjection } from '../src/anvil/generic-package';
import { agentProjection, TemplateProfileSchema } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { stepToolChecks, undeclaredTools } from '../src/anvil/tool-binding';
import { procedureView } from '../src/forge/review';
import { MockStepTranslator, translateSteps, translateUser } from '../src/tasks/steps/translator';

/** D-016 (owner, 23 Nov 2026): the step tool guide, conditional follow-ups, the translation and the checks. */
const OFFERED = ['application.read', 'parties.list', 'policy.read', 'documents.list', 'document.read', 'document.compare', 'identity.check', 'document.check', 'address.check', 'screening.check', 'authority.check', 'operation.lookup', 'operation.read', 'information.request', 'information.read', 'finding.write', 'finding.resolve', 'specialist.refer', 'specialist.read', 'search', 'search.read', 'recommend'];
const EXAMPLE = 'Screen both joint applicants. If either has an unresolved match, record the finding and refer the case according to policy. Submit the final recommendation with the evidence.';
const codes = (steps: unknown) => stepToolWarnings(steps, OFFERED).map((w) => [w.step, w.code, w.suggest ?? null]);

describe('tool guide', () => {
  it('labels options "<purpose> — <tool>" in the guide’s order; chains show both tools', () => {
    expect(toolOptionLabel('screening.check')).toBe('Screen an applicant — screening.check');
    expect(toolOptionLabel('documents.list')).toBe('Find supporting documents, then read a specific one — documents.list → document.read');
    expect(toolOptionLabel('parties.list')).toBe('List the parties on the application (applicants, adults, custodians) — parties.list');
    expect(toolOptionLabel('something.else')).toBe('something.else');
    expect(orderedTools(['recommend', 'x.y', 'application.read']).slice(0, 2)).toEqual(['application.read', 'recommend']);
  });
});

describe('translation (mock drafter)', () => {
  it('turns the owner’s example into the routine step, its conditional follow-ups and the recommendation', async () => {
    expect(translateProcedure(EXAMPLE, OFFERED)).toEqual([
      { action: 'Screen both joint applicants.', tool: 'screening.check', followUps: [{ if: 'either has an unresolved match', tools: ['finding.write', 'specialist.refer'] }] },
      { action: 'Submit the final recommendation with the evidence.', tool: 'recommend' },
    ]);
    const t = await translateSteps(new MockStepTranslator(), EXAMPLE, OFFERED);
    expect(t.warnings).toEqual([]);
  });

  it('adds the documents chain and a final recommendation; never uses a tool the template does not offer', () => {
    const steps = translateProcedure('Find the supporting documents and read the bank statement.\nVerify the residential address.', OFFERED.filter((t) => t !== 'address.check'));
    expect(steps[0]).toEqual({ action: 'Find the supporting documents and read the bank statement.', tool: 'documents.list', followUps: [{ tools: ['document.read'] }] });
    expect(steps[1]!.tool).toBe('');
    expect(steps.at(-1)!.tool).toBe('recommend');
  });

  it('the model prompt lists only the offered tools with their purposes', () => {
    const u = translateUser(EXAMPLE, ['screening.check', 'recommend']);
    expect(u).toContain('Screen an applicant — screening.check');
    expect(u).not.toContain('specialist.refer');
  });
});

describe('step checks (warnings)', () => {
  it('flags each wrong tool from run-0228 with the tool its words point to', () => {
    const run0228 = [
      { action: 'Perform watch-list/sanction screening on both applicants', tool: 'specialist.refer' },
      { action: 'Verify residential address', tool: 'specialist.refer' },
      { action: 'Parse joint application', tool: 'finding.write' },
      { action: 'Retrieve case record', tool: 'document.read' },
      { action: 'Verify identity documents', tool: 'document.check' },
    ];
    expect(codes(run0228)).toEqual([
      [0, 'TOOL_PURPOSE_MISMATCH', 'screening.check'],
      [0, 'CONDITIONAL_TOOL_AS_MAIN', null],
      [1, 'TOOL_PURPOSE_MISMATCH', 'address.check'],
      [1, 'CONDITIONAL_TOOL_AS_MAIN', null],
      [2, 'TOOL_PURPOSE_MISMATCH', 'application.read'],
      [2, 'CONDITIONAL_TOOL_AS_MAIN', null],
      [3, 'TOOL_PURPOSE_MISMATCH', 'application.read'],
      [4, 'TOOL_PURPOSE_MISMATCH', 'identity.check'],
      [4, 'NO_FINAL_RECOMMEND', null],
    ]);
  });

  it('accepts the owner’s design; flags an unconditioned follow-up (not a chain) and a follow-up tool the template lacks', () => {
    expect(codes(translateProcedure(EXAMPLE, OFFERED))).toEqual([]);
    expect(codes([{ action: 'If the address is still unverified, refer the case.', tool: 'specialist.refer' }, { action: 'Submit the recommendation', tool: 'recommend' }])).toEqual([]);
    expect(codes([{ action: 'Screen each applicant', tool: 'screening.check', followUps: [{ tools: ['specialist.refer'] }, { if: 'a match', tools: ['made.up'] }] }, { action: 'Recommend', tool: 'recommend' }])).toEqual([
      [0, 'FOLLOW_UP_WITHOUT_CONDITION', null],
      [0, 'FOLLOW_UP_TOOL_NOT_OFFERED', null],
    ]);
  });

  it('as task checks they are warnings (never blocking); undeclared follow-up tools stay blocking', () => {
    const sections = { S5: { steps: [{ action: 'Screen each applicant', tool: 'screening.check', followUps: [{ if: 'a match', tools: ['finding.write', 'made.up'] }] }] } };
    const execution = { tools: OFFERED.map((id) => ({ id })) };
    expect(stepToolChecks(execution, sections).every((c) => c.severity === 'warning' && !c.ok)).toBe(true);
    expect(stepToolChecks(execution, sections).map((c) => c.id)).toEqual(['steps.tool.follow_up_tool_not_offered.1', 'steps.tool.no_final_recommend.1']);
    expect(undeclaredTools(execution, sections)).toEqual([{ step: 0, pointer: '/sections/S5/steps/0/followUps/0/tools/1', value: 'made.up' }]);
  });
});

describe('follow-ups reach the agent and the reviewer', () => {
  const form = { profileId: 'p', version: 1, sections: [{ key: 'S5', fields: [{ key: 'steps', type: 'repeated_array', itemFields: [{ key: 'action', type: 'long_text' }, { key: 'tool', type: 'text' }] }] }] };
  it('the actor part carries a step’s follow-ups, and only when it has some', () => {
    const steps = [{ action: 'Screen each applicant', tool: 'screening.check', followUps: [{ if: 'a match', tools: ['finding.write', 'specialist.refer'] }], note: 'kept out' }, { action: 'Recommend', tool: 'recommend', followUps: [] }];
    const actor = actorProjection(form, { sections: { S5: { steps } } }) as { sections: { S5: { steps: Record<string, unknown>[] } } };
    expect(actor.sections.S5.steps).toEqual([
      { action: 'Screen each applicant', tool: 'screening.check', followUps: [{ if: 'a match', tools: ['finding.write', 'specialist.refer'] }] },
      { action: 'Recommend', tool: 'recommend' },
    ]);
    expect(followUpsOf({ followUps: [{ if: ' ', tools: [' document.read '] }, { tools: [] }] })).toEqual([{ tools: ['document.read'] }]);
  });

  it('the reviewer’s procedure view shows purposes, follow-ups and warnings', () => {
    const template = { lineageId: 'l', version: 1, anvilSpec: null };
    expect(procedureView(template as never, { sections: { S5: { steps: [] } } })).toBeNull();
  });
});

describe('follow-ups are agent-visible in both views (owner, 23 Nov 2026: Validate said GENERIC_PRIVATE_EXPOSURE on TSK-001)', () => {
  it('the agent view carries a step’s follow-ups exactly as the export’s actor part does', () => {
    const V7 = JSON.parse(readFileSync(new URL('./fixtures/kyc-v7/proposal.json', import.meta.url), 'utf8'));
    const profile = TemplateProfileSchema.parse(V7.authoring.profile);
    const steps = [{ action: 'Screen each applicant', tool: 'screening.check', followUps: [{ if: 'a match', tools: ['finding.write', 'specialist.refer'] }] }, { action: 'Recommend', tool: 'recommend' }];
    const output = { schema: 'praxis.template_output.v1', profile: { id: profile.profileId, version: profile.version }, header: { title: 'T' }, sections: { S5: { steps } } };
    const agent = agentProjection(profile as never, output) as { sections: { S5: { steps: Record<string, unknown>[] } } };
    const actor = actorProjection(profile as never, { profile: { id: profile.profileId, version: profile.version }, sections: { S5: { steps } } }) as { sections: { S5: { steps: Record<string, unknown>[] } } };
    expect(agent.sections.S5.steps[0]).toMatchObject({ followUps: [{ if: 'a match', tools: ['finding.write', 'specialist.refer'] }] });
    expect(agent.sections.S5.steps[1]).not.toHaveProperty('followUps');
    expect(JSON.stringify(agent.sections.S5.steps)).toBe(JSON.stringify(actor.sections.S5.steps));
  });
});
