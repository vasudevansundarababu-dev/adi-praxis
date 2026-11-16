import { BANNED_PUBLIC_NAMES, profileForTemplate, publicText, type TemplateProfile, type TutorialCard, type TutorialScript } from '@praxis/shared';

/**
 * D2 (docs/plan/PLAN-D2-TUTORIAL-VIDEO.md): what a template's tutorial video covers, from the template's own field
 * definitions only. Chapter 1 is an overview; then one chapter per form section, in form order.
 */
export interface ChapterPlan {
  title: string;
  /** What the chapter must explain, for the script drafter. Never task, SME or project data. */
  brief: string;
  cards: TutorialCard[];
}

type TemplateLike = { workflowName: string; profileId: string | null; primaryWork: string | null; verificationCriteria: string | null; humanGate: string | null };

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** What a field asks for, in plain words, from its type, rules and help. */
function needOf(f: TemplateProfile['sections'][number]['fields'][number]): string {
  const parts: string[] = [];
  parts.push(f.required === true ? 'Required.' : f.required ? 'Required in some cases.' : 'Optional.');
  if (f.options?.length) parts.push(`Pick from: ${f.options.slice(0, 6).map((o) => o.label).join(', ')}${f.options.length > 6 ? ', …' : ''}.`);
  if (f.visibility === 'private_reference' || f.visibility === 'private_rubric') parts.push('Seen by reviewers only, never by the agent.');
  if (f.type === 'number' && (f.min !== undefined || f.max !== undefined)) parts.push(`A number${f.min !== undefined ? ` from ${f.min}` : ''}${f.max !== undefined ? ` up to ${f.max}` : ''}.`);
  if (f.minItems) parts.push(`At least ${f.minItems} ${f.itemLabel ?? 'item'}${f.minItems > 1 ? 's' : ''}.`);
  parts.push(f.help);
  return clip(parts.join(' '), 400);
}

/** The template's profile, or null when it has no sections form (then no tutorial can be generated). */
export function profileOf(t: TemplateLike): TemplateProfile | null {
  const r = profileForTemplate({ workflowName: t.workflowName, profileId: t.profileId });
  return r.status === 'ok' ? r.profile : null;
}

export function chapterPlan(t: TemplateLike, profile: TemplateProfile): ChapterPlan[] {
  const overview: ChapterPlan = {
    title: 'Overview',
    brief: [
      `Workflow: ${t.workflowName}.`,
      t.primaryWork ? `What the expert produces: ${t.primaryWork}` : '',
      t.verificationCriteria ? `How it is checked: ${t.verificationCriteria}` : '',
      t.humanGate ? `Human review: ${t.humanGate}` : '',
      `The form has ${profile.sections.length} sections: ${profile.sections.map((s) => s.title).join('; ')}.`,
      'Every case is synthetic: invented people and companies only.',
    ]
      .filter(Boolean)
      .join(' '),
    cards: profile.sections.map((s, i) => ({ label: `${i + 1}. ${s.title}`, need: clip(s.help ?? `${s.fields.length} field${s.fields.length === 1 ? '' : 's'}`, 400), example: '' })),
  };
  const sections = profile.sections.map((s) => ({
    title: clip(s.title, 100),
    brief: [s.help ?? '', s.checksOnly ? 'This section shows the checks that run before submit, and the submit step.' : ''].filter(Boolean).join(' ') || s.title,
    cards: s.fields.slice(0, 30).map((f) => ({ label: clip(f.label, 120), need: needOf(f), example: clip(f.example ?? '', 400) })),
  }));
  return [overview, ...sections].map((c) => ({ ...c, title: publicText(c.title), brief: publicText(c.brief), cards: c.cards.map(cleanCard) }));
}

const cleanCard = (c: TutorialCard): TutorialCard => ({ label: publicText(c.label), need: publicText(c.need), example: publicText(c.example) });

/** Every string a user would see or hear, for the public-names check. */
export function publicStrings(script: TutorialScript): string[] {
  return script.chapters.flatMap((c) => [c.title, c.narration, ...c.cards.flatMap((x) => [x.label, x.need, x.example])]);
}

/**
 * The script after the drafter: same chapters as the plan, in order; internal names replaced; then a hard check. A
 * banned name left anywhere a user sees or hears it fails the run (returns the problem).
 */
export function finalizeScript(script: TutorialScript, plan: ChapterPlan[]): { script: TutorialScript } | { problem: string } {
  if (script.chapters.length !== plan.length) return { problem: `The script has ${script.chapters.length} chapters; the template needs ${plan.length}.` };
  const chapters = script.chapters.map((c, i) => ({
    ...c,
    // The chapter titles and cards are the template's own; the model writes the narration and scenes only.
    title: plan[i]!.title,
    narration: publicText(c.narration),
    cards: plan[i]!.cards.map((card, j) => ({ ...card, example: card.example || publicText(c.cards[j]?.example ?? '') })),
  }));
  const out = { chapters };
  const hit = publicStrings(out).find((s) => BANNED_PUBLIC_NAMES.test(s));
  if (hit) return { problem: 'The script names an internal system; nothing was generated from it.' };
  if (chapters.some((c) => c.scenes.some((s) => BANNED_PUBLIC_NAMES.test(s)))) return { problem: 'A scene prompt names an internal system; nothing was generated from it.' };
  return { script: out };
}
