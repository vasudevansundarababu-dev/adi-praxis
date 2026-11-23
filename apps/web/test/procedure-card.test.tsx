import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProcedureCard } from '@/components/forge/task-page';
import { a11yProblems } from './a11y';

/** D-016: the reviewer sees each step's tool by purpose, its conditional follow-ups and the tool guide's warnings. */
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Procedure and tool guide card', () => {
  it('shows purposes, follow-ups and warnings', () => {
    const html = renderToStaticMarkup(
      <ProcedureCard
        procedure={{
          steps: [
            { action: 'Screen both joint applicants.', tool: 'screening.check', toolLabel: 'Screen an applicant — screening.check', followUps: [{ if: 'either has an unresolved match', tools: ['finding.write', 'specialist.refer'] }] },
            { action: 'Verify residential address', tool: 'specialist.refer', toolLabel: 'Route an unresolved issue to a specialist when policy requires it — specialist.refer', followUps: [] },
          ],
          warnings: [{ step: 1, code: 'TOOL_PURPOSE_MISMATCH', message: 'Step 2 says “Verify residential address” but its tool is specialist.refer.', suggest: 'address.check' }],
        }}
      />,
    );
    const t = text(html);
    expect(t).toContain('Tool: Screen an applicant — screening.check');
    expect(t).toContain('If either has an unresolved match: finding.write → specialist.refer');
    expect(t).toContain('Step 2 says “Verify residential address” but its tool is specialist.refer.');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('says so when every step fits', () => {
    expect(text(renderToStaticMarkup(<ProcedureCard procedure={{ steps: [{ action: 'Recommend', tool: 'recommend', toolLabel: 'Submit the final onboarding recommendation — recommend', followUps: [] }], warnings: [] }} />))).toContain('Every step’s tool fits its words');
  });
});
