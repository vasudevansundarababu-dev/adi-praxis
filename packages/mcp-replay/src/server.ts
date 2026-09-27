import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { replayCall, type ReplayBundle } from '@praxis/shared';

/**
 * A reference MCP server for one accepted KYC task (docs/TASK-DRAFTING.md section 5). `tools/list` returns the tools
 * the task offers, with their inputSchema; `tools/call` returns the recorded result for matching arguments, or an
 * error result. It is a test and reference tool: how RL Gym runs tasks is RL Gym's own concern.
 */
export function replayServer(bundle: ReplayBundle) {
  const server = new Server({ name: 'praxis-kyc-replay', version: bundle.catalogVersion }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: bundle.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => replayCall(bundle, req.params.name, req.params.arguments ?? {}));
  return server;
}
