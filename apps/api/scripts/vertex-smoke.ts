/**
 * Authoring v2.1 QA smoke check: one live call to the authoring chatbot model and one embedding call on Vertex.
 * Run in the QA environment (it makes two small billed calls), never in tests or locally without intent:
 *   pnpm --filter @praxis/api exec tsx --env-file-if-exists=../../.env scripts/vertex-smoke.ts
 * Exit 0 = both live calls worked and returned valid output; 2 = Vertex is not configured (mock mode); 1 = a call failed.
 * Prints model ids, latency and token counts only: no prompt or answer text, no credentials.
 */
import { ConversationProposal } from '@praxis/shared';
import { loadConfig } from '../src/config';
import { VertexConversationAssistant } from '../src/tasks/conversation/assistant';
import { VertexEmbeddingProvider } from '../src/tasks/embeddings';

async function main() {
  const config = loadConfig(process.env);
  if (config.assistantMode !== 'vertex') {
    console.log(JSON.stringify({ ok: false, mode: 'mock', reason: 'VERTEX_PROJECT_ID is not set: this environment uses mock providers.' }));
    process.exit(2);
  }
  const results: Record<string, unknown>[] = [];
  let failed = false;

  const chat = new VertexConversationAssistant({ projectId: config.VERTEX_PROJECT_ID, region: config.VERTEX_LOCATION, model: config.AUTHORING_MODEL });
  let started = Date.now();
  try {
    const proposal = await chat.propose({
      workflow: 'KYC onboarding and refresh',
      current: { header: { title: 'Smoke check task' } },
      slot: { brief: 'Smoke check: synthetic applicant with a missing address document.' },
      history: [{ speaker: 'AUTHOR', content: 'The applicant supplied an identity record but no address record.' }],
      policy: null,
      previousUnresolved: [],
    });
    ConversationProposal.parse(proposal);
    results.push({ check: 'authoring-chatbot', ok: true, model: chat.model, latencyMs: Date.now() - started });
  } catch (e) {
    failed = true;
    results.push({ check: 'authoring-chatbot', ok: false, model: chat.model, latencyMs: Date.now() - started, error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : 'error' });
  }

  const emb = new VertexEmbeddingProvider({ projectId: config.VERTEX_PROJECT_ID, location: config.EMBEDDING_LOCATION ?? 'us-central1', model: config.EMBEDDING_MODEL });
  started = Date.now();
  try {
    const v = await emb.embed('Smoke check: synthetic KYC case text.');
    if (!Array.isArray(v) || v.length === 0) throw new Error('Empty embedding');
    results.push({ check: 'embeddings', ok: true, model: emb.model, dimensions: v.length, latencyMs: Date.now() - started });
  } catch (e) {
    failed = true;
    results.push({ check: 'embeddings', ok: false, model: emb.model, latencyMs: Date.now() - started, error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : 'error' });
  }

  console.log(JSON.stringify({ ok: !failed, mode: 'vertex', location: config.VERTEX_LOCATION, results }, null, 2));
  process.exit(failed ? 1 : 0);
}

void main();
