import { STUDIO_STEP_IDS, type CustomField } from '@praxis/shared';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CustomFieldControl, DropzoneControl, OracleGrid } from '@/components/studio/controls';
import { StudioClosed } from '@/components/studio/studio-closed';
import { StudioWorkbench } from '@/components/studio/studio-workbench';
import { handleStudioMock } from '@/lib/studio/mock-backend';
import type { StudioConfig } from '@/lib/studio/types';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const ok = (el: ReactElement) => expect(a11yProblems(renderToStaticMarkup(el))).toEqual([]);
const config = handleStudioMock('GET', '/candidate/studio/a11y-studio', undefined, { smeUserId: '00000000-0000-4000-8000-000000000001' }).body as StudioConfig;

describe('NFR-10 Screen 4 studio', () => {
  it('every authoring step passes the static checks', () => {
    for (const step of STUDIO_STEP_IDS) ok(<StudioWorkbench config={config} studioUrl="http://localhost:3131/studio/a11y-studio" smeLabel="Sam Synthetic" tasks={[]} initialStep={step} />);
  });

  it('every custom field type is labelled', () => {
    for (const input_type of ['number_input', 'currency_slider', 'single_select', 'multi_select', 'boolean_toggle', 'text_input'] as const) {
      const f: CustomField = { field_id: `f_${input_type}`, label: input_type, input_type, options: ['A', 'B'], default_value: null, min: 0, max: 10, inject_into: ['task.json'], verifier_assertion: '' };
      ok(<CustomFieldControl field={f} value={null} onChange={() => undefined} />);
    }
    ok(<DropzoneControl label="Queries" format="csv" targetPath="/workspace/inputs/q.csv" value="" onChange={() => undefined} />);
    ok(<OracleGrid columns={['k']} tagOptions={['BUY']} previewRows={[['a']]} rows={[]} onChange={() => undefined} />);
  });

  it('the studio-closed page', () => ok(<StudioClosed workflowName="Launch" status="STOPPED" />));
});
