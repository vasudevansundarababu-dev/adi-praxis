import { chapterTime, parseChapterTime } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TutorialSettings, tutorialFormProblem } from '@/components/templates/tutorial-settings';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const ID = '00000000-0000-4000-8000-000000000001';
const tutorial = { videoUrl: 'https://v.example.test/kyb.mp4', chapters: [{ title: 'S1 Brief', at: 0 }, { title: 'Submitting', at: 150 }] };

describe('MVP1 step 7: template Tutorial video card', () => {
  it('parses and prints chapter times as mm:ss', () => {
    expect(parseChapterTime('2:30')).toBe(150);
    expect(parseChapterTime('1:02:03')).toBe(3723);
    expect(parseChapterTime('45')).toBe(45);
    expect(parseChapterTime('2:75')).toBeNull();
    expect(parseChapterTime('abc')).toBeNull();
    expect(chapterTime(150)).toBe('2:30');
    expect(chapterTime(3723)).toBe('1:02:03');
  });

  it('checks the form before saving', () => {
    expect(tutorialFormProblem('', [])).toBeNull();
    expect(tutorialFormProblem('http://x.test/a.mp4', [])).toMatch(/https/);
    expect(tutorialFormProblem('https://x.test/a.mp4', [{ title: '', time: '0:00' }])).toMatch(/needs a title/);
    expect(tutorialFormProblem('https://x.test/a.mp4', [{ title: 'Start', time: 'soon' }])).toMatch(/mm:ss/);
    expect(tutorialFormProblem('https://x.test/a.mp4', [{ title: 'Start', time: '0:10' }])).toBeNull();
  });

  it('Admins get the URL input, chapter rows and Save; others see the current value read-only', () => {
    const admin = renderToStaticMarkup(<TutorialSettings template={{ id: ID, tutorial }} canEdit />);
    expect(admin).toContain('Tutorial video');
    expect(admin).toContain('value="https://v.example.test/kyb.mp4"');
    expect(admin).toContain('value="2:30"');
    expect(admin).toContain('>Save<');
    expect(a11yProblems(admin)).toEqual([]);
    const pm = renderToStaticMarkup(<TutorialSettings template={{ id: ID, tutorial }} canEdit={false} />);
    expect(pm).not.toContain('<input');
    expect(pm).not.toContain('>Save<');
    expect(pm).toContain('href="https://v.example.test/kyb.mp4"');
    expect(pm).toContain('Submitting');
    expect(renderToStaticMarkup(<TutorialSettings template={{ id: ID, tutorial: null }} canEdit={false} />)).toContain('No tutorial video yet.');
  });
});
