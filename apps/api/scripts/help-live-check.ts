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

// Second set (night of 26 Nov 2026): the pages and roles the first set did not cover.
const sme = (page: string, q: string, path = '/home', title = 'Home'): Q => ({ page, audience: 'SME', path, title, roles: ['SME'], q });
const staff = (page: string, q: string, path = '/', title = 'Home', roles = ['PM']): Q => ({ page, audience: 'STAFF', path, title, roles, q });
export const QUESTIONS_2: Q[] = [
  sme('SME Home', 'What does the Next step card mean?'),
  sme('SME Task page', 'What goes in each section of my task?'),
  sme('SME Task page', 'Can I use a real customer name in my task?'),
  sme('SME Task page', 'My work did not save, what do I do?'),
  sme('SME Task page', 'What does Show an example do?'),
  sme('SME Task page', 'What is the workflow below the form?'),
  sme('SME Task page', 'How do I write a conditional follow-up in S5?'),
  sme('SME Task page', 'Where do the bank rules for my task come from?'),
  sme('SME Task page', 'How do I propose a bank policy document?'),
  sme('SME Benchmark panel', 'What are archetype and complexity?'),
  sme('SME Benchmark panel', 'How do I raise a need for a situation that is not listed?'),
  sme('SME Review page', 'I am a reviewer. How do I send a task back?', '/home', 'Home'),
  sme('SME Rework', 'Why did my task come back after the expert changed my rubric?'),
  sme('SME Run reviews', 'What does Dispute: the task needs correction do?', '/run-reviews', 'Run reviews'),
  sme('SME Edge-case outcomes', 'Why do my edge-case outcome answers matter?', '/edge-outcomes', 'Edge-case outcomes'),
  sme('SME Bell', 'What does the bell show me?'),
  sme('SME Payments', 'What happens if a payment fails?', '/payments', 'Payments'),
  sme('SME Sign in', 'How do I sign in for the first time?', '/welcome', 'Before you start'),
  sme('SME Verify', 'Why do I need to verify my identity?', '/verify', 'Verify your identity'),
  sme('SME Profile', 'How do I build my SME profile?', '/enrollments/x', 'Your SME profile'),
  sme('SME Application status', 'What does More information requested mean?', '/enrollments/x/status', 'Your application'),
  sme('SME Onboarding', 'What do I do on the onboarding checklist?', '/enrollments/x/onboarding', 'Onboarding'),
  sme('SME Certification', 'How many attempts do I get at the test?', '/certifications', 'Certifications'),
  { page: 'SME Task page (Help, author)', audience: 'SME', scope: 'TASK_AUTHOR', path: '/', title: 'Task', roles: ['SME'], q: 'What should I put in S2 Evidence and parties?' },
  { page: 'SME Review page (Help, reviewer)', audience: 'SME', scope: 'TASK_REVIEWER', path: '/', title: 'Review a task', roles: ['Reviewer'], q: 'What should I check in S6?' },
  staff('Staff Menu', 'Where is the Reviews menu?'),
  staff('Staff Home', 'What do the tiles on Home mean?'),
  staff('Staff Bell', 'What does the bell show?'),
  staff('Staff New project', 'How do I create a new project?', '/projects/new', 'New project'),
  staff('Staff Dashboard', 'What does the Next step banner on the Dashboard mean?', '/projects/p', 'Project'),
  staff('Staff Assign', 'How do I assign a Reviewer to a task?', '/projects/p/assign', 'Assign people'),
  staff('Staff Export', 'When can I export to RL Gym?', '/projects/p', 'Project'),
  staff('Staff Task page', 'Why can I not decide on this task?', '/projects/p/tasks/t/review', 'Task'),
  staff('Staff Task page', 'How do I send an approved task back to the author?', '/projects/p/tasks/t/review', 'Task'),
  staff('Staff Benchmark tab', 'How do I send edge-case outcomes to an SME?', '/projects/p', 'Project'),
  staff('Staff Benchmark tab', 'Who decides the benchmark review episodes?', '/projects/p', 'Project'),
  staff('Staff Policies tab', 'How do I publish the rule set?', '/projects/p', 'Project'),
  staff('Staff Rule page', 'How do I exclude a duplicate rule?', '/projects/p/policy/rules/r', 'Policy rule'),
  staff('Staff Rule page', 'What does the rule page show?', '/projects/p/policy/rules/r', 'Policy rule'),
  staff('Staff Candidate sign-in', 'What does Offline sign-in mean?', '/admin/candidate-sign-in', 'Candidate app sign-in', ['Admin']),
];

const PRICE = { input: 0.3, output: 2.5 }; // USD per million tokens, gemini flash (list price; see policy/ai-pricing.ts)

(async () => {
  const [out = 'help-live.json', capArg = '16', firstArg = '0', lastArg, setArg = '1', budgetArg = '1'] = process.argv.slice(2);
  const cap = Number(capArg);
  const budget = Number(budgetArg);
  const config = loadConfig();
  const m = supportModel(config);
  if (m.vendor !== 'gemini') throw new Error(`Expected a Gemini support model, got ${m.value}`);
  const bot = new GeminiSupportAssistant(m.model, { projectId: config.VERTEX_PROJECT_ID, location: config.VERTEX_LOCATION });
  const kyc = TEMPLATE_PROFILES.find((p) => p.catalogWorkflowName === 'KYC onboarding and refresh')!;
  const record = { task: { status: 'IN_PROGRESS', brief: 'Teen joint account: the parent provides everything except the minor\'s taxpayer ID.', openSlot: false, coverage: null }, template: { name: kyc.catalogWorkflowName, sections: kyc.sections.map((s) => ({ section: s.key, title: s.title, filled: s.key === 'S1' })) }, rules: [], reviewComments: [] };
  const qs = (setArg === '2' ? QUESTIONS_2 : QUESTIONS).slice(Number(firstArg), lastArg ? Number(lastArg) : undefined).slice(0, cap);
  const results: unknown[] = [];
  let inTok = 0;
  let outTok = 0;
  let asked = 0;
  for (const q of qs) {
    // Hard stop at the spend the owner approved (USD, list price).
    if ((inTok * PRICE.input + outTok * PRICE.output) / 1e6 >= budget) break;
    asked++;
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
  writeFileSync(out, JSON.stringify({ model: m.value, calls: asked, inputTokens: inTok, outputTokens: outTok, usd, results }, null, 2));
  console.log(`\ncalls ${asked} · input ${inTok} · output ${outTok} · about $${usd.toFixed(4)}`);
})();
