/**
 * Help-text audit (owner, 26 Nov 2026): ask the live Support Bot real questions with this branch's help pack and
 * print the answers, the token use and the cost. Spends money: run only with the owner's yes, and keep under the cap.
 * Usage (from apps/api): npx tsx --env-file=../../.env scripts/help-live-check.ts <out.json> <cap> [first] [last]
 */
import { writeFileSync } from 'node:fs';
import { TEMPLATE_PROFILES } from '@praxis/shared';
import { loadConfig } from '../src/config';
import { GeminiSupportAssistant, supportModel, type SupportContext } from '../src/support/assistant';
import { templateGuide } from '../src/support/authoring-help';
import { SME_HELP, STAFF_HELP } from '../src/support/help-pack';

type Q = { page: string; audience: 'SME' | 'STAFF'; scope?: 'TASK_AUTHOR' | 'TASK_REVIEWER'; path: string; title: string; roles: string[]; q: string };
export const QUESTIONS: Q[] = [
  { page: 'SME Home', audience: 'SME', path: '/home', title: 'Home', roles: ['SME'], q: 'What should I do next on my home page?' },
  { page: 'SME Home', audience: 'SME', path: '/home', title: 'Home', roles: ['SME'], q: 'What does Rework mean on my task list?' },
  { page: 'SME Task page', audience: 'SME', path: '/home', title: 'Home', roles: ['SME'], q: 'Why can I not paste text into my task?' },
  { page: 'SME Task page', audience: 'SME', path: '/home', title: 'Home', roles: ['SME'], q: 'How do I submit my task?' },
  { page: 'SME Benchmark panel', audience: 'SME', path: '/home', title: 'Home', roles: ['SME'], q: 'What is an edge-case family and when should I pick one?' },
  { page: 'SME Run reviews', audience: 'SME', path: '/home', title: 'Home', roles: ['SME'], q: 'What verdict do I choose on a run review?' },
  { page: 'SME Edge-case outcomes', audience: 'SME', path: '/home', title: 'Home', roles: ['SME'], q: 'How do I answer a batch of edge-case outcomes?' },
  { page: 'SME Payments', audience: 'SME', path: '/home', title: 'Home', roles: ['SME'], q: 'When do I get paid?' },
  { page: 'SME Task page (Help, author)', audience: 'SME', scope: 'TASK_AUTHOR', path: '/', title: 'Task', roles: ['SME'], q: 'What goes in S7 Rubric?' },
  { page: 'SME Task page (Help, author)', audience: 'SME', scope: 'TASK_AUTHOR', path: '/', title: 'Task', roles: ['SME'], q: 'How do I submit?' },
  { page: 'SME Review page (Help, reviewer)', audience: 'SME', scope: 'TASK_REVIEWER', path: '/', title: 'Review a task', roles: ['Reviewer'], q: 'How do I send it back or approve it?' },
  { page: 'Staff Policy page', audience: 'STAFF', path: '/projects/p/policy', title: 'Policy rules', roles: ['PM'], q: 'what is a fact' },
  { page: 'Staff Policy page', audience: 'STAFF', path: '/projects/p/policy', title: 'Policy rules', roles: ['PM'], q: 'what does Set when it applies mean' },
  { page: 'Staff Task page', audience: 'STAFF', path: '/projects/p/tasks/t/review', title: 'Task', roles: ['PM'], q: 'How do I correct an approved task?' },
  { page: 'Staff Roles', audience: 'STAFF', path: '/', title: 'Home', roles: ['Admin'], q: 'What is the difference between a Reviewer and a Validator?' },
  { page: 'Staff Templates', audience: 'STAFF', path: '/templates', title: 'Templates', roles: ['PM'], q: 'How do I change a template?' },
];

const PRICE = { input: 0.3, output: 2.5 }; // USD per million tokens, gemini flash (list price; see policy/ai-pricing.ts)

(async () => {
  const [out = 'help-live.json', capArg = '16', firstArg = '0', lastArg] = process.argv.slice(2);
  const cap = Number(capArg);
  const config = loadConfig();
  const m = supportModel(config);
  if (m.vendor !== 'gemini') throw new Error(`Expected a Gemini support model, got ${m.value}`);
  const bot = new GeminiSupportAssistant(m.model, { projectId: config.VERTEX_PROJECT_ID, location: config.VERTEX_LOCATION });
  const kyc = TEMPLATE_PROFILES.find((p) => p.catalogWorkflowName === 'KYC onboarding and refresh')!;
  const record = { task: { status: 'IN_PROGRESS', brief: 'Teen joint account: the parent provides everything except the minor\'s taxpayer ID.', openSlot: false, coverage: null }, template: { name: kyc.catalogWorkflowName, sections: kyc.sections.map((s) => ({ section: s.key, title: s.title, filled: s.key === 'S1' })) }, rules: [], reviewComments: [] };
  const qs = QUESTIONS.slice(Number(firstArg), lastArg ? Number(lastArg) : undefined).slice(0, cap);
  const results: unknown[] = [];
  let inTok = 0;
  let outTok = 0;
  for (const q of qs) {
    const ctx: SupportContext = {
      audience: q.audience,
      roles: q.roles,
      help: q.audience === 'SME' ? SME_HELP : STAFF_HELP,
      screen: { path: q.path, title: q.title, headings: [], fields: [], messages: [] },
      record: q.scope ? { source: 'this task', data: record } : null,
      ...(q.scope ? { scope: q.scope, templates: [templateGuide(kyc)] } : {}),
    };
    const r = await bot.answer(ctx, [], q.q);
    inTok += r.usage.inputTokens;
    outTok += r.usage.outputTokens;
    results.push({ ...q, answer: r.answer, usage: r.usage });
    console.log(`\n### ${q.page}${q.scope ? ` [${q.scope}]` : ''} — ${q.q}\n${r.answer}`);
  }
  const usd = (inTok * PRICE.input + outTok * PRICE.output) / 1e6;
  writeFileSync(out, JSON.stringify({ model: m.value, calls: qs.length, inputTokens: inTok, outputTokens: outTok, usd, results }, null, 2));
  console.log(`\ncalls ${qs.length} · input ${inTok} · output ${outTok} · about $${usd.toFixed(4)}`);
})();
