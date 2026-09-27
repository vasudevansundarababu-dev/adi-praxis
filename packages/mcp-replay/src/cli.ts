#!/usr/bin/env -S npx tsx
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ReplayBundle } from '@praxis/shared';
import { replayServer } from './server';

/**
 * Usage: praxis-mcp-replay <bundle.json>
 * The bundle is the response of GET /api/v1/dataset/records/:id/replay (Admin or RL Gym key).
 */
const file = process.argv[2];
if (!file) {
  console.error('Usage: praxis-mcp-replay <bundle.json>  (from GET /api/v1/dataset/records/:id/replay)');
  process.exit(2);
}
const bundle = JSON.parse(readFileSync(file, 'utf8')) as ReplayBundle;
await replayServer(bundle).connect(new StdioServerTransport());
