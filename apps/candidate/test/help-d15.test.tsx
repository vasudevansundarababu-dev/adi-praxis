import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HelpBoundary, HelpDrawer } from '@/components/forge/task-aids';

/**
 * D15 (16 Nov 2026): asking Help crashed the whole task page once the answer arrived. Cause: the drawer's auto-scroll
 * effect returned scrollIntoView's result, which current Chrome makes a Promise; React then called it as the effect's
 * clean-up ("destroy is not a function"). Reproduced in Chrome against a local stack with RUBRIC_RECOMMENDATIONS and
 * FIELD_SUGGESTIONS on; e2e/task-help.spec.ts covers the browser path.
 */
const root = path.resolve(__dirname, '..');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (n === 'node_modules' || n.startsWith('.next')) return [];
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('D15: Help never takes down the task page', () => {
  it('no effect in the candidate app returns a browser call’s result (only nothing, a clean-up, a setState or void)', () => {
    const bad: string[] = [];
    for (const f of [...sources(path.join(root, 'components')), ...sources(path.join(root, 'app'))]) {
      for (const m of readFileSync(f, 'utf8').matchAll(/useEffect\(\(\) => (?!\{|void |set[A-Z])([^\n]*)/g)) bad.push(`${path.relative(root, f)}: ${m[1]!.slice(0, 80)}`);
    }
    expect(bad).toEqual([]);
  });

  it('the Help drawer’s auto-scroll effect has a block body', () => {
    const src = readFileSync(path.join(root, 'components/forge/task-aids.tsx'), 'utf8');
    expect(src).not.toMatch(/useEffect\(\(\) => end\.current/);
    expect(src).toMatch(/void end\.current\?\.scrollIntoView\?\.\(\{ block: 'end' \}\);/);
  });

  it('a failure inside Help shows a message and Close; the page around it keeps rendering', () => {
    expect(HelpBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const onClose = vi.fn();
    const ok = new HelpBoundary({ onClose, children: <p>drawer</p> });
    expect(renderToStaticMarkup(<>{ok.render()}</>)).toBe('<p>drawer</p>');
    const failed = new HelpBoundary({ onClose, children: <p>drawer</p> });
    failed.state = { failed: true };
    const html = renderToStaticMarkup(<>{failed.render()}</>);
    expect(html).toContain('data-help-failed');
    expect(html).toContain('Help ran into a problem. Your task is safe and still saves. Close Help and try again.');
    expect(html).toContain('>Close</button>');
    expect(html).not.toContain('drawer');
  });

  it('the drawer still renders as before', () => {
    const html = renderToStaticMarkup(<HelpDrawer endpoint="/me/tasks/t/help" kind="author" onClose={() => undefined} />);
    expect(html).toContain('Help for this task');
    expect(html).toContain('Your question about this task');
  });
});
