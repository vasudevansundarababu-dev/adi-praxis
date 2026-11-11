import { profileApplies, profileProblems, type ProfileProblem } from './helpers';
import type { SectionKey, TemplateProfile } from './schema';

/**
 * Template-aware question planner (authoring v2.1 Wave 2, handover ch. 06). Deterministic: from the template profile
 * and what the SME has already saved, it picks the next required field that is still missing and asks for it in the
 * SME's own words, using the field's label and help. When the SME's latest answer is about a particular part of the
 * task (evidence, tools, policy, outcome, rubric), questions about that part come first, so corrections are followed
 * through. It never proposes content and never shows examples (examples teach structure, not the assigned case).
 */
export interface PlannedQuestion {
  question: string;
  section: SectionKey;
  field: string;
}

const TOPICS: [RegExp, SectionKey][] = [
  [/\b(evidence|document|record|party|parties|owner(ship)?|identity|address)\b/i, 'S2'],
  [/\b(tool|response|screening|lookup|registry|call)\b/i, 'S3'],
  [/\b(policy|rule|exception|regulation|requirement)\b/i, 'S4'],
  [/\b(step|process|finding|rationale|hand-?off|workflow)\b/i, 'S5'],
  [/\b(outcome|disposition|decision|recommend(ation)?|rating|release)\b/i, 'S6'],
  [/\b(rubric|grading|criteri(on|a)|weight|credit|critical)\b/i, 'S7'],
];

export function planNextQuestion(profile: TemplateProfile, output: unknown, latestAnswer = ''): PlannedQuestion | null {
  if (!profileApplies(profile, output)) return null;
  const problems = profileProblems(profile, output).filter((p) => p.kind !== 'invalid');
  if (!problems.length) return null;
  const topic = TOPICS.find(([re]) => re.test(latestAnswer))?.[1];
  const pick: ProfileProblem = (topic && problems.find((p) => p.section === topic)) || problems[0]!;
  const section = profile.sections.find((s) => s.key === pick.section)!;
  const field = section.fields.find((f) => f.key === pick.field);
  const label = field?.label ?? pick.field;
  const help = field?.help ? ` ${field.help.trim().replace(/\s+/g, ' ')}` : '';
  const what = pick.kind === 'min_items' ? `add at least one entry to “${label}”` : `“${label}” is still missing`;
  return {
    section: pick.section,
    field: pick.field,
    question: `${section.title} (${pick.section}): ${what}.${help} Please write it in your own words.`,
  };
}
