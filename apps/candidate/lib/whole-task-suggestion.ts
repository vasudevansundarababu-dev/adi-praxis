import { publicText, type TemplateProfile } from '@praxis/shared';

/**
 * D25: a suggested whole-task failure condition, drafted from the criterion itself (what it assesses, its lowest-level
 * text, the rules it links to) and the template's critical-failure rules (e.g. Marketing CR-01 to CR-06). It's only
 * ever offered after the SME ticks the box; the SME uses, edits or dismisses it. No model is called and nothing is
 * decided for the SME: the box stays as the SME left it.
 */

export interface CriticalRule {
  id: string;
  label: string;
}

/** The template's critical-failure rules: the options of its `criticalFailures` field, the task's own picks first. */
export function criticalRulesFor(profile: TemplateProfile, output: unknown): CriticalRule[] {
  for (const s of profile.sections) {
    for (const f of s.fields) {
      if (f.key !== 'criticalFailures' || !f.options?.length) continue;
      const sec = output && typeof output === 'object' ? (output as Record<string, unknown>)[s.key] : null;
      const raw = sec && typeof sec === 'object' ? (sec as Record<string, unknown>)[f.key] : null;
      const picked = new Set(Array.isArray(raw) ? raw.map(String) : []);
      const all = f.options.map((o) => ({ id: o.value, label: publicText(o.label) }));
      return [...all.filter((r) => picked.has(r.id)), ...all.filter((r) => !picked.has(r.id))];
    }
  }
  return [];
}

const STOP = new Set(['the', 'and', 'or', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'with', 'without', 'is', 'are', 'be', 'by', 'as', 'at', 'it', 'its', 'any', 'not', 'no', 'when', 'while', 'that', 'this', 'from', 'only', 'each', 'every', 'agent']);
/** Words reduced to a short stem, so "submits" meets "submission" and "fabricates" meets "fabricated". */
const stems = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/\bcr-?\d+\b/g, ' ')
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );

const sentence = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/[.;:,\s]+$/, '');
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

export function suggestWholeTaskCondition(input: {
  name: string;
  assesses: string;
  /** The lowest score level's text (Fail / Level 0). */
  lowest: string;
  /** Labels of the policy rules the criterion links to. */
  linkedRules: string[];
  criticalRules: CriticalRule[];
}): string {
  const lowest = sentence(input.lowest);
  const assesses = sentence(input.assesses);
  const name = sentence(input.name);
  if (!lowest && !assesses && !name) return '';
  const own = stems([input.name, input.assesses, input.lowest].join(' '));
  const matched = input.criticalRules
    .map((r) => ({ r, score: [...stems(r.label)].filter((w) => own.has(w)).length }))
    .filter((m) => m.score >= 2 || (m.score === 1 && stems(m.r.label).size <= 2))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((m) => m.r.label);
  const parts: string[] = [];
  if (lowest) parts.push(`The whole task fails when the run shows this criterion at its lowest level: ${lowerFirst(lowest)}.`);
  else if (assesses) parts.push(`The whole task fails when the run shows the agent did not meet this criterion: ${lowerFirst(assesses)}.`);
  else parts.push(`The whole task fails when the run shows the agent failed ${name}.`);
  if (matched.length) parts.push(`This is the template’s critical failure ${matched.join(' and ')}.`);
  const rules = [...new Set(input.linkedRules.map((l) => sentence(publicText(l))).filter(Boolean))].slice(0, 3);
  if (rules.length) parts.push(`Linked rule${rules.length > 1 ? 's' : ''}: ${rules.join('; ')}.`);
  parts.push('Judge it only from what the run shows, never from intent.');
  return parts.join(' ');
}
