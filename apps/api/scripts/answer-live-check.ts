import { conditionLabel, PolicyRuleBody, type FactCatalog } from '@praxis/shared';
import { readFileSync } from 'node:fs';
import { answerCostUsd, checkedProposal, VertexAnswerFiller } from '../src/policy/answers';
import { loadConfig } from '../src/config';
import { policyAiModel } from '../src/policy/rule-assistant';

/**
 * "Fill from my answer" live check (owner approved a $0.50 budget for AI answers on 27 Nov 2026). Synthetic rules and
 * the test fact catalog only, never a real project. Needs LIVE=1; stops before a call once this run has spent $0.05.
 * Prints each proposal, its tokens and its cost.
 */
if (process.env.LIVE !== '1') throw new Error('Set LIVE=1 to make live model calls.');
const config = loadConfig();
if (config.assistantMode !== 'vertex') throw new Error('No Vertex project configured.');
const filler = new VertexAnswerFiller(policyAiModel(config), { projectId: config.VERTEX_PROJECT_ID, location: config.VERTEX_LOCATION });
const catalog = JSON.parse(readFileSync(new URL('../test/fixtures/kyc-judgment/kyc-judgment-openenv.fact-catalog.json', import.meta.url), 'utf8')) as FactCatalog;
const STOP_USD = 0.05;

const cases = [
  { question: 'Should the rule cover remote openings?', answer: 'Mobile licences are fine for both branch and remote.', body: { title: 'Mobile driver licence as ID', requirement: 'A mobile driver licence is accepted as primary ID.', library: { kind: 'policy', issuer: 'bank', subject: 'party', scope: { process: 'account_opening' } } } },
  { question: 'Which jurisdiction does this rule cover?', answer: 'It is a California state rule, it always applies to account opening there.', body: { title: 'California minor accounts', requirement: 'A minor may hold a joint account with a parent.', library: { kind: 'regulation', subject: 'party' } } },
  { question: 'Should document validity be evaluated via id_age_days or an expiration date fact?', answer: 'Use the expiration date; we reject IDs that expired more than 30 days ago.', body: { title: 'Expired ID', requirement: 'An ID expired more than 30 days is not accepted.', library: { kind: 'policy', issuer: 'bank', jurisdiction: 'US', subject: 'party', scope: { process: 'account_opening' } } } },
];

let total = 0;
for (const c of cases) {
  if (total >= STOP_USD) {
    console.log(`stopped: $${total.toFixed(6)} spent`);
    break;
  }
  const body = PolicyRuleBody.parse(c.body);
  const started = Date.now();
  const r = await filler.fill({ question: c.question, answer: c.answer, rule: { ruleKey: 'R-LIVE-CHECK', title: body.title, requirement: body.requirement, library: body.library ?? null, condition: body.condition ?? null, effectiveFrom: body.effective.from }, catalog });
  const cost = answerCostUsd(filler.model, r.inputTokens, r.outputTokens, config.POLICY_AI_PRICE_USD_PER_MTOK);
  total += cost;
  const checked = checkedProposal(r.raw, body, catalog, (x) => conditionLabel(x as never, catalog));
  console.log(JSON.stringify({ question: c.question, answer: c.answer, model: filler.model, ms: Date.now() - started, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: cost, changes: checked.changes.map((x) => `${x.field}: ${x.before} → ${x.after}`), message: checked.message }));
}
console.log(`total $${total.toFixed(6)}`);
