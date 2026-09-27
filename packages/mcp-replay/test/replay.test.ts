import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { KYC_EXAMPLE_TASK, replayBundle } from '@praxis/shared';
import { replayServer } from '../src/server';

async function connect() {
  const bundle = replayBundle(KYC_EXAMPLE_TASK);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await replayServer(bundle).connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  return { client, bundle };
}

describe('MCP replay server (TASK-DRAFTING section 5)', () => {
  it('lists the task’s tools with their inputSchema', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['document_check', 'registry_lookup', 'sanctions_pep_screening', 'risk_calculator', 'request_info']);
    expect(tools.find((t) => t.name === 'sanctions_pep_screening')!.inputSchema).toMatchObject({ type: 'object', required: ['name'] });
  });

  it('answers every recorded call with its recorded result, and errors otherwise', async () => {
    const { client, bundle } = await connect();
    for (const c of bundle.calls) {
      const r = await client.callTool({ name: c.request.params.name, arguments: c.request.params.arguments });
      expect(r).toMatchObject(c.result);
    }
    expect(await client.callTool({ name: 'sanctions_pep_screening', arguments: { name: 'Nobody' } })).toMatchObject({ isError: true, content: [{ type: 'text', text: 'No recorded response for these arguments.' }] });
    expect(await client.callTool({ name: 'adverse_media_search', arguments: { name: 'Soren Dunmore' } })).toMatchObject({ isError: true });
  });
});
