import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { templateStartingGraph } from '@praxis/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewGraph } from '@/components/tasks/review-graph';
import { a11yProblems } from './a11y';

describe('Authoring v2.1 console', () => {
  it('reviewers see the same workflow graph component the author used (no drift between the two apps)', () => {
    const web = readFileSync(join(__dirname, '../components/tasks/workflow-graph-view.tsx'), 'utf8').split('\n').slice(2).join('\n');
    const candidate = readFileSync(join(__dirname, '../../candidate/components/work/workflow-graph-view.tsx'), 'utf8').split('\n').slice(1).join('\n');
    expect(web).toBe(candidate);
  });

  it('renders the review graph read-only and accessibly', () => {
    const html = renderToStaticMarkup(<ReviewGraph graph={templateStartingGraph('AML transaction-monitoring alerts')} />);
    expect(html).toContain('Passes every workflow check');
    expect(html).toContain('data-testid="workflow-graph"');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('reports an unreadable graph instead of drawing a partial one', () => {
    expect(renderToStaticMarkup(<ReviewGraph graph={{ nodes: [] }} />)).toContain('cannot be read');
  });
});
