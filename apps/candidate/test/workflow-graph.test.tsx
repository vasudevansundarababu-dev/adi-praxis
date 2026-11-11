import { checkWorkflowGraph, templateStartingGraph, WorkflowGraph } from '@praxis/shared';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowGraphPanel } from '@/components/work/workflow-graph-panel';
import { WorkflowGraphView } from '@/components/work/workflow-graph-view';
import { a11yProblems } from './a11y';

const ok = (el: ReactElement) => expect(a11yProblems(renderToStaticMarkup(el))).toEqual([]);
const kyc = () => WorkflowGraph.parse(templateStartingGraph('KYC onboarding and refresh'));

describe('Authoring v2.1 workflow graph below the editors', () => {
  it('draws every node and labelled connection as an SVG graph with decisions as diamonds', () => {
    const g = kyc();
    const html = renderToStaticMarkup(<WorkflowGraphView graph={g} selected={null} onSelect={() => undefined} problemNodes={new Set()} />);
    expect(html).toContain('data-testid="workflow-graph"');
    for (const n of g.nodes) expect(html).toContain(`data-node="${n.id}"`);
    expect(html).toContain('<polygon');
    for (const label of ['Sufficient', 'Missing', 'Other', 'Unclear', 'Re-review', 'No response']) expect(html).toContain(label);
    expect(html).toContain('stroke-dasharray="5 4"');
    expect(html).toContain('Person in the case');
  });

  it('shows the same connections as an accessible list on request', () => {
    const html = renderToStaticMarkup(<WorkflowGraphView graph={kyc()} selected="review" onSelect={() => undefined} problemNodes={new Set(['complete'])} asList />);
    expect(html).toContain('data-testid="workflow-graph-list"');
    expect(html).toContain('↺ returns to Review evidence');
    expect(html).toContain('aria-pressed="true"');
  });

  it('marks nodes with problems for screen readers', () => {
    const html = renderToStaticMarkup(<WorkflowGraphView graph={kyc()} selected={null} onSelect={() => undefined} problemNodes={new Set(['sufficient'])} />);
    expect(html).toContain('(has problems)');
  });

  it('offers the template workflow when the task has none, only where editing is allowed', () => {
    const start = templateStartingGraph('KYC onboarding and refresh');
    expect(renderToStaticMarkup(<WorkflowGraphPanel taskId="t" graph={null} startingGraph={start} agentMode="SINGLE" editable />)).toContain('Start from the template workflow');
    expect(renderToStaticMarkup(<WorkflowGraphPanel taskId="t" graph={null} startingGraph={start} agentMode="SINGLE" editable={false} />)).toContain('Switch to Classic');
  });

  it('reports problems with the precise reason and keeps the same graph in Classic and Chatbot', () => {
    const g = structuredClone(templateStartingGraph('KYB and beneficial ownership')!);
    g.edges = g.edges.filter((e) => e.port !== 'else');
    const classic = renderToStaticMarkup(<WorkflowGraphPanel taskId="t" graph={g} startingGraph={null} agentMode="SINGLE" editable />);
    const chatbot = renderToStaticMarkup(<WorkflowGraphPanel taskId="t" graph={g} startingGraph={null} agentMode="SINGLE" editable={false} />);
    expect(classic).toContain('needs an &quot;else&quot; route');
    const svg = (h: string) => h.slice(h.indexOf('<svg'), h.indexOf('</svg>'));
    expect(svg(classic)).toBe(svg(chatbot));
    expect(checkWorkflowGraph(g).ok).toBe(false);
  });

  it('passes the static accessibility checks', () => {
    ok(<WorkflowGraphView graph={kyc()} selected="review" onSelect={() => undefined} problemNodes={new Set()} />);
    ok(<WorkflowGraphView graph={kyc()} selected={null} onSelect={() => undefined} problemNodes={new Set()} asList />);
    ok(<WorkflowGraphPanel taskId="t" graph={templateStartingGraph('AML transaction-monitoring alerts')} startingGraph={null} agentMode="SINGLE" editable />);
  });
});
