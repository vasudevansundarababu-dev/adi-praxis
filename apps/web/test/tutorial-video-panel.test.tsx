import type { TutorialRunDto, TutorialRunsResponse } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TutorialSettings } from '@/components/templates/tutorial-settings';
import { TutorialVideoPanel } from '@/components/templates/tutorial-video-panel';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const ID = '00000000-0000-4000-8000-000000000001';
const generation: TutorialRunsResponse['generation'] = { blockedReason: null, live: true, estimatedUsd: 11.97, spentTodayUsd: 0, costCapUsd: 40, dailyCapUsd: 100, chapters: 9 };
const run = (o: Partial<TutorialRunDto>): TutorialRunDto => ({
  id: '00000000-0000-4000-8000-000000000002',
  templateId: ID,
  templateVersion: 2,
  trigger: 'ADMIN',
  status: 'QUEUED',
  videoModel: 'veo-3.1-fast-generate-001',
  scriptModel: 'gemini-2.5-flash',
  estimatedUsd: 23.49,
  actualUsd: 0,
  durationSeconds: null,
  chapters: [],
  script: null,
  previewUrl: null,
  captionsUrl: null,
  error: null,
  rejectReason: null,
  decidedAt: null,
  createdAt: '2026-11-15T10:00:00.000Z',
  ...o,
});
const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

describe('D2: AI tutorial video panel (Admin)', () => {
  it('shows the cost before generating, and the Generate button', () => {
    const html = renderToStaticMarkup(<TutorialVideoPanel templateId={ID} initial={{ runs: [], generation }} />);
    const t = text(html);
    expect(t).toContain('AI tutorial video');
    expect(t).toContain('Chapters 9');
    expect(t).toContain('Estimated cost $11.97');
    expect(t).toContain('Per-video cap $40.00');
    expect(t).toContain('$0.00 / $100.00');
    expect(t).toMatch(/SMEs and Reviewers see it only after you approve it/);
    expect(html).toMatch(/<button[^>]*>Generate tutorial<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Generate tutorial/);
    expect(a11yProblems(html)).toEqual([]);
  });

  it('a blocked reason disables Generate and is shown', () => {
    const html = renderToStaticMarkup(<TutorialVideoPanel templateId={ID} initial={{ runs: [], generation: { ...generation, blockedReason: 'Tutorial video generation is switched off in this environment.', live: false, costCapUsd: null, dailyCapUsd: null } }} />);
    expect(text(html)).toContain('switched off in this environment');
    expect(text(html)).toContain('Estimated cost None (mock)');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Generate tutorial/);
  });

  it('a working run shows its progress; a ready one has a preview with captions, chapters, the script, Approve and Reject', () => {
    expect(text(renderToStaticMarkup(<TutorialVideoPanel templateId={ID} initial={{ runs: [run({ status: 'CLIPS', actualUsd: 2.5 })], generation }} />))).toMatch(/Making the video clips .*page updates by itself.*cost so far \$2\.50/);
    const ready = run({
      status: 'READY_FOR_REVIEW',
      previewUrl: 'https://storage.test/tutorials/a/b/tutorial.mp4?sig=1',
      captionsUrl: 'https://storage.test/tutorials/a/b/captions.vtt?sig=1',
      chapters: [{ title: 'Overview', at: 0 }, { title: 'S1 Brief', at: 21 }],
      script: { chapters: [{ title: 'Overview', narration: 'Welcome to ADI Forge.', cards: [], scenes: ['a', 'b'] }, { title: 'S1 Brief', narration: 'The brief.', cards: [], scenes: ['a', 'b'] }] },
    });
    const html = renderToStaticMarkup(<TutorialVideoPanel templateId={ID} initial={{ runs: [ready], generation: { ...generation, blockedReason: 'A tutorial for this workflow is already being made or waiting for approval.' } }} />);
    expect(html).toMatch(/<video[^>]*src="https:\/\/storage\.test\/tutorials\/a\/b\/tutorial\.mp4\?sig=1"/);
    expect(html).toMatch(/<track kind="captions" src="https:\/\/storage\.test\/tutorials\/a\/b\/captions\.vtt\?sig=1"/);
    const t = text(html);
    expect(t).toContain('Ready for your review');
    expect(t).toContain('0:21 S1 Brief');
    expect(t).toContain('Welcome to ADI Forge.');
    expect(t).toContain('Approve and show on task pages');
    expect(t).toContain('Reject');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('a failed run shows why; an approved generated video is described, not shown as an address', () => {
    expect(text(renderToStaticMarkup(<TutorialVideoPanel templateId={ID} initial={{ runs: [run({ status: 'FAILED', error: 'Stopped: the per-video cost cap of $3.00 was reached.' })], generation }} />))).toContain('per-video cost cap of $3.00 was reached');
    const tutorial = { videoUrl: 'storage:tutorials/a/b/tutorial.mp4', chapters: [{ title: 'Overview', at: 0 }] };
    const ro = renderToStaticMarkup(<TutorialSettings template={{ id: ID, tutorial }} canEdit={false} />);
    expect(text(ro)).toContain('Generated tutorial video (approved by an Admin).');
    expect(ro).not.toContain('storage:');
    const admin = renderToStaticMarkup(<TutorialSettings template={{ id: ID, tutorial }} canEdit />);
    expect(admin).not.toContain('value="storage:');
    expect(text(admin)).toContain('Saving an address here replaces it');
  });
});
