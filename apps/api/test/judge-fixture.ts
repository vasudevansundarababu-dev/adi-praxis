import { HarborBlueprint, type HarborBlueprintInput } from '@praxis/shared';
import { generatorFixtureInput } from '../../../packages/shared/test/blueprint-fixture';

/**
 * Invented, synthetic case for the LLM judge tests: the fictitious "Quietline" phone launch with an Admin-fixed
 * exhibit and a judged memo milestone. Criteria hold marker words (ANSWERKEY-*) so leak tests can search for them.
 */
export const FIXED_EXHIBIT = '# Exhibit A (synthetic)\nQuietline launch budget: 4200 credits over 6 weeks.\n';

export function judgedBlueprintInput(): HarborBlueprintInput {
  const bp = generatorFixtureInput();
  bp.step_2_data_panels!.public_dropzones!.push({ id: 'exhibit', label: 'Case exhibit', target_path: '/workspace/inputs/exhibit.md', format: 'md', fixed_content: FIXED_EXHIBIT });
  const ms = bp.step_5_default_rubric!.milestones!;
  ms[0]!.weight = 40;
  ms[1]!.weight = 20;
  ms.push(
    {
      id: 'memo',
      label: 'Launch memo',
      weight: 30,
      verifier_template: 'llm_judge_checklist',
      verifier_body: "assert 'memo.md' in env_state['outputs']",
      judge: {
        deliverable_path: '/workspace/outputs/memo.md',
        system_prompt: 'You grade a launch memo. ANSWERKEY-PROMPT: be strict.',
        criteria: [
          { num: 1, category: 'Budget', text: 'ANSWERKEY-ONE: states the budget of 4200 credits', points: 2 },
          { num: 2, category: 'Timing', text: 'ANSWERKEY-TWO: plans 6 weeks with a review in week 3', points: 3 },
          { num: 3, category: 'Risk', text: 'ANSWERKEY-THREE: names the counterfeit risk', points: 1 },
        ],
      },
    },
    {
      id: 'faq',
      label: 'Press FAQ',
      weight: 10,
      verifier_template: 'llm_judge_checklist',
      verifier_body: "assert 'faq.md' in env_state['outputs']",
      judge: {
        deliverable_path: '/workspace/outputs/faq.md',
        system_prompt: 'You grade a press FAQ.',
        criteria: [{ num: 1, category: '', text: 'ANSWERKEY-FAQ: answers the price question with 349', points: 4 }],
      },
    },
  );
  return bp;
}

export const judgedBlueprint = () => HarborBlueprint.parse(judgedBlueprintInput());
