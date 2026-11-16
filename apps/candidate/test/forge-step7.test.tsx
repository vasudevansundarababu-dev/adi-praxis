import { TASK_HELP_SUGGESTIONS, tutorialKind } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HelpDrawer, TaskAids, TutorialCard } from '@/components/forge/task-aids';
import { a11yProblems } from './a11y';

const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const chapters = [{ title: 'S1 Brief', at: 0 }, { title: 'Submitting', at: 425 }];

describe('MVP1 step 7: Tutorial card', () => {
  it('chooses a video for .mp4/.webm/.mov, a link otherwise, and none without a tutorial', () => {
    expect(tutorialKind({ videoUrl: 'https://v.example.test/a.mp4' })).toBe('video');
    expect(tutorialKind({ videoUrl: 'https://v.example.test/a.WEBM?sig=1' })).toBe('video');
    expect(tutorialKind({ videoUrl: 'https://v.example.test/a.mov#t=3' })).toBe('video');
    expect(tutorialKind({ videoUrl: 'https://www.youtube.com/watch?v=abc' })).toBe('link');
    expect(tutorialKind({ videoUrl: 'https://v.example.test/mp4' })).toBe('link');
    expect(tutorialKind(null)).toBe('none');
    expect(tutorialKind(undefined)).toBe('none');
  });

  it('D2: a generated video carries its English captions track', () => {
    const html = renderToStaticMarkup(<TutorialCard tutorial={{ videoUrl: 'https://storage.test/t/tutorial.mp4?sig=1', captionsUrl: 'https://storage.test/t/captions.vtt?sig=1', chapters }} />);
    expect(html).toMatch(/<video[^>]*crossorigin="anonymous"/i);
    expect(html).toMatch(/<track kind="captions" src="https:\/\/storage\.test\/t\/captions\.vtt\?sig=1" srclang="en" label="English" default=""/i);
    expect(renderToStaticMarkup(<TutorialCard tutorial={{ videoUrl: 'https://v.example.test/a.mp4', chapters }} />)).not.toContain('<track');
  });

  it('renders an HTML5 video with chapter buttons that seek', () => {
    const html = renderToStaticMarkup(<TutorialCard tutorial={{ videoUrl: 'https://v.example.test/a.mp4', chapters }} />);
    expect(html).toMatch(/<video[^>]*controls/);
    expect(html).toContain('src="https://v.example.test/a.mp4"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(text(html)).toContain('0:00 S1 Brief');
    expect(text(html)).toContain('7:05 Submitting');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('renders a link (new tab, noopener) for other addresses, with chapters as text', () => {
    const html = renderToStaticMarkup(<TutorialCard tutorial={{ videoUrl: 'https://www.youtube.com/watch?v=abc', chapters }} />);
    expect(html).not.toContain('<video');
    expect(html).toMatch(/<a href="https:\/\/www.youtube.com\/watch\?v=abc" target="_blank" rel="noopener noreferrer"[^>]*>Open the tutorial video<\/a>/);
    expect(html).not.toContain('<button');
    expect(text(html)).toContain('7:05 Submitting');
  });

  it('says so when the task has no tutorial', () => {
    const html = renderToStaticMarkup(<TutorialCard tutorial={null} />);
    expect(text(html)).toContain('No tutorial video for this task yet.');
    expect(html).not.toContain('<video');
  });
});

describe('MVP1 step 7: Help drawer', () => {
  it('shows the scope note and the suggested questions for authors', () => {
    const html = renderToStaticMarkup(<HelpDrawer endpoint="/me/tasks/t1/help" kind="author" onClose={() => undefined} />);
    expect(text(html)).toContain('Answers questions about this task and its form only. It explains and gives examples; you write the task.');
    expect(TASK_HELP_SUGGESTIONS.author.length).toBeGreaterThanOrEqual(3);
    expect(TASK_HELP_SUGGESTIONS.author.length).toBeLessThanOrEqual(4);
    for (const q of TASK_HELP_SUGGESTIONS.author) expect(text(html)).toContain(q);
    expect(text(html)).toContain('What goes in S1?');
    expect(text(html)).toContain('How do I submit?');
    expect(html).toContain('Ask');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('frames the suggestions for reviewers', () => {
    const html = renderToStaticMarkup(<HelpDrawer endpoint="/me/reviews/t1/help" kind="reviewer" onClose={() => undefined} />);
    for (const q of TASK_HELP_SUGGESTIONS.reviewer) expect(text(html)).toContain(q);
  });

  it('the task page bar has Tutorial and Help buttons; the drawer is closed until Help is pressed', () => {
    const closed = renderToStaticMarkup(<TaskAids taskId="t1" kind="author" tutorial={null} />);
    expect(text(closed)).toContain('Tutorial');
    expect(closed).toContain('aria-label="Help"'); // D13: the floating Ember mascot
    expect(closed).not.toContain('data-task-help');
    const open = renderToStaticMarkup(<TaskAids taskId="t1" kind="author" tutorial={null} initial="help" />);
    expect(open).toContain('data-task-help');
    expect(a11yProblems(open)).toEqual([]);
  });
});
