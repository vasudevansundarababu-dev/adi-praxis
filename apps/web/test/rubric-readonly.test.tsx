import { RUBRIC_INTERNAL_ONLY, scoreKeysFor, type RubricView } from '@praxis/shared';
import { describe, expect, it } from 'vitest';
import { RubricReadOnly } from '../components/forge/rubric-readonly';
import { a11yProblems } from './a11y';
import { html, text } from './helpers';

/**
 * Console task page (PM/Admin), read-only rubric details (rubric recommendations plan, section 2; D8 "the reviewer sees
 * which anchors were changed from the default"). No decision changes; no new approval stage.
 */
const VIEW: RubricView = {
  aiEnabled: false,
  template: { id: 't', version: 2, scale: 'five_two_zero', scoreKeys: scoreKeysFor('five_two_zero'), fixedSet: true, wholeTaskRule: '', criterionFailureSupported: true, weightsFromTemplate: true },
  rubric: { section: 'S7', fieldKey: 'criteria' },
  seed: null,
  criteria: [
    {
      id: 'identification_verification',
      origin: 'TEMPLATE_DEFAULT',
      exportable: true,
      annotationVersion: 2,
      details: { assesses: 'Verify identity', applicability: { kind: 'REQUIRED', condition: 'Every application this task covers.', exceptions: '' }, wholeTaskFailure: { condition: 'Recommends clearance while identity verification is incomplete.', kind: 'FAIL_OF_CRITERION' }, evidenceRequired: '', stepLabel: null, roleLabel: null, skill: null, why: '', unresolved: [], covers: [] },
      editedFields: [],
      aiFields: ['assesses'],
      links: [{ target: 'task:S5.steps[1]', kind: 'WORKFLOW_STEP', label: 'Workflow · Verify identity', excerpt: 'Verify identity', snapshot: 'a'.repeat(64), state: 'CHANGED', currentExcerpt: 'Verify identity and address' }],
      needs: [],
      sourceChanged: true,
      defaults: { id: 'identification_verification', partialCredit: 'Some parties verified' },
      changedFromDefault: ['partialCredit'],
      technical: [],
      howChecked: { text: 'RL Gym scores this from the recorded run.', setupNeeded: false },
      proposed: {},
    },
  ],
  additions: [],
  sources: { version: 0, items: [], available: [] },
  coverage: { total: 3, covered: 2, gaps: [{ key: 'r', label: 'S4 · Policy rules · R-SC-1' }], duplicates: [] },
  unused: [],
  run: null,
  history: [],
  internalOnly: RUBRIC_INTERNAL_ONLY,
};

describe('read-only rubric on the console task page', () => {
  it('shows edited-from-default, whole-task condition, changed sources, AI label and coverage; never says Ready', () => {
    const m = html(<RubricReadOnly view={VIEW} items={[{ id: 'identification_verification', name: 'Identity verified', critical: true, passCondition: 'p', partialCredit: 'My words', failCondition: 'f' }]} />);
    const t = text(m);
    expect(t).toContain('Edited from template default: partialCredit');
    expect(t).toContain('Whole-task failure when: Recommends clearance while identity verification is incomplete.');
    expect(t).toContain('Source changed — check rubric');
    expect(t).toContain('Workflow · Verify identity (changed)');
    expect(t).toContain('AI suggestion');
    expect(t).toContain('Coverage: 2 of 3 required items');
    expect(t).toContain('RL Gym doesn’t receive these details yet');
    expect(t).not.toMatch(/\bReady\b|Anvil|Praxis/);
    expect(a11yProblems(m)).toEqual([]);
  });
});
