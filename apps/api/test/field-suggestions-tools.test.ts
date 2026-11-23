import { describe, expect, it } from 'vitest';
import { suggestUser, type SuggestContext } from '../src/tasks/suggestions/assistant';
import { keepDeclaredStepTools } from '../src/tasks/suggestions/service';

/**
 * APR-13d: an AI suggestion for S5 procedure steps named tools the template does not declare ("case_data_fetcher"),
 * so the PM's approval was refused with GENERIC_TOOL_UNDECLARED. The suggester is now told the template's tool IDs,
 * and any other tool in a suggested step is blanked before the author sees it.
 */
const TOOLS = ['application.read', 'address.check', 'screening.check'];

describe('field suggestions keep S5 step tools to the template’s tools', () => {
  it('blanks a suggested step tool the template does not declare and keeps declared or blank ones', () => {
    const steps = [
      { action: 'Read the application', tool: 'application.read' },
      { action: 'Fetch the case', tool: 'case_data_fetcher' },
      { action: 'Verify the address', tool: 'address_verification_tool' },
      { action: 'Summarise', tool: '' },
      { action: 'Decide' },
    ];
    expect(keepDeclaredStepTools('S5', 'steps', steps, TOOLS)).toEqual([
      { action: 'Read the application', tool: 'application.read' },
      { action: 'Fetch the case', tool: '' },
      { action: 'Verify the address', tool: '' },
      { action: 'Summarise', tool: '' },
      { action: 'Decide' },
    ]);
  });

  it('leaves other fields, other sections and templates without a tool list alone', () => {
    const steps = [{ action: 'x', tool: 'made_up' }];
    expect(keepDeclaredStepTools('S5', 'steps', steps, null)).toBe(steps);
    expect(keepDeclaredStepTools('S4', 'steps', steps, TOOLS)).toBe(steps);
    expect(keepDeclaredStepTools('S5', 'goal', 'text', TOOLS)).toBe('text');
    expect(keepDeclaredStepTools('S5', 'steps', undefined, TOOLS)).toBeUndefined();
  });

  it('tells the model the declared tool IDs, and says nothing about tools when there are none', () => {
    const ctx: SuggestContext = { workflow: 'KYC', section: { key: 'S5', title: 'Procedure' }, slot: { brief: null, caseLabel: null }, rules: [], authorText: [], again: false };
    const field = { key: 'steps', field: { key: 'steps', label: 'Steps', type: 'list' } } as never;
    expect(suggestUser([field], { ...ctx, tools: TOOLS })).toContain("a step's tool must be exactly one of these IDs, or blank): application.read, address.check, screening.check");
    expect(suggestUser([field], ctx)).not.toContain('tools the agent can call');
  });
});
