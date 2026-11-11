import { INVALID_CASES, buildInvalidCase, multiAgentKyb, singleAgentKyc } from '../src/workflow-graph/fixtures';
import { WORKFLOW_GRAPH_SCHEMA } from '../src/workflow-graph/schema';

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** Every fixture file as [relative path, exact contents]. */
export function renderWorkflowGraphFixtures(): [string, string][] {
  const files: [string, string][] = [
    ['valid/single-agent-kyc.json', json(singleAgentKyc())],
    ['valid/multi-agent-kyb.json', json(multiAgentKyb())],
  ];
  for (const c of INVALID_CASES) files.push([`invalid/${c.name}.json`, json(buildInvalidCase(c))]);
  files.push([
    'expected.json',
    json({
      schema: WORKFLOW_GRAPH_SCHEMA,
      note: 'Each invalid fixture must produce at least these error codes. Valid fixtures must produce no errors.',
      valid: ['single-agent-kyc.json', 'multi-agent-kyb.json'],
      invalid: Object.fromEntries(INVALID_CASES.map((c) => [`${c.name}.json`, { description: c.description, expect: c.expect }])),
    }),
  ]);
  return files;
}
