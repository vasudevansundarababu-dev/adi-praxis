import { z } from 'zod';
import type { CoverageDimensions, EdgeCaseCatalog } from './templates';

// ───────────────────────── Coverage slots (SPEC: Task diversity and coverage) ─────────────────────────

export interface SlotSpec {
  /** Dimension values fixed by the slot. Open and edge-case slots let the author add the rest. */
  tags: Record<string, string>;
  edgeCase: string | null;
  isOpen: boolean;
  /** Counts towards the project's minimum coverage. */
  required: boolean;
  brief: string;
  /** The case-selector value this slot is for (one slot per value), with the form field that must carry it. */
  case?: SlotCase;
}

/** A template's case selector (golden pack `template.caseSelector`): one task per value of a required pick list. */
export interface CaseSelector {
  field: string;
  /** `S<n>.<fieldKey>` of the form, e.g. `S1.governingState`. */
  source: string;
  values: string[];
}

export interface SlotCase {
  field: string;
  source: string;
  value: string;
}

/**
 * One required slot per case-selector value (KYC five-state contract, 13 Nov 2026): the target is one task per value,
 * so slots are never open and never repeat a value. `labelOf` gives the value's display label, when known.
 */
export function caseSelectorSlots(sel: CaseSelector, opts: { fieldLabel?: string; labelOf?: (value: string) => string | undefined } = {}): SlotSpec[] {
  const name = opts.fieldLabel ?? sel.field;
  return sel.values.map((value) => {
    const label = opts.labelOf?.(value);
    const shown = label && label !== value ? `${label} (${value})` : value;
    return {
      tags: { [sel.field]: value },
      edgeCase: null,
      isOpen: false,
      required: true,
      brief: `${name}: ${shown}. Write this reusable task for ${label ?? value} only; set ${name} to ${value}.`,
      case: { field: sel.field, source: sel.source, value },
    };
  });
}

export interface SlotInput {
  dimensions: CoverageDimensions['dimensions'];
  cells: { tags: Record<string, string>; quota: number; required: boolean }[];
  edgeCases: { name: string; description: string; quota: number; required: boolean }[];
  distinctTarget: number;
  openSlotShare: number;
}

const label = (dims: SlotInput['dimensions'], k: string) => dims.find((d) => d.key === k)?.label ?? k;
export function slotBrief(dims: SlotInput['dimensions'], s: Pick<SlotSpec, 'tags' | 'edgeCase' | 'isOpen'>, edgeDescription = ''): string {
  if (s.isOpen) return 'Open slot: bring a realistic case from your own experience. Choose its coverage tags and name the edge case it tests.';
  // Dimension order, not object key order (jsonb reorders keys).
  const order = (k: string) => (dims.findIndex((d) => d.key === k) + 1 || 999);
  const parts = Object.entries(s.tags)
    .sort(([a], [b]) => order(a) - order(b))
    .map(([k, v]) => `${label(dims, k)}: ${v}`);
  if (s.edgeCase) parts.push(`Edge case: ${s.edgeCase}${edgeDescription ? ` (${edgeDescription})` : ''}`);
  return parts.join(' · ');
}

/** Cartesian product of the dimensions that have values, in a stable order. */
function combinations(dims: SlotInput['dimensions']): Record<string, string>[] {
  const usable = dims.filter((d) => d.values.length > 0);
  let out: Record<string, string>[] = [{}];
  for (const d of usable) out = out.flatMap((c) => d.values.map((v) => ({ ...c, [d.key]: v })));
  return usable.length ? out : [];
}

/**
 * Generates the distinct-task target as slots: required cells and edge cases first (by quota), then open slots
 * (the open-slot share, never displacing required coverage), then optional cells and edge cases, then the remaining
 * slots spread across dimension combinations so no two experts write the same case. Deterministic.
 */
export function generateSlots(i: SlotInput): SlotSpec[] {
  const out: SlotSpec[] = [];
  const edgeDesc = new Map(i.edgeCases.map((e) => [e.name, e.description]));
  const cell = (tags: Record<string, string>, required: boolean): SlotSpec => ({ tags, edgeCase: null, isOpen: false, required, brief: slotBrief(i.dimensions, { tags, edgeCase: null, isOpen: false }) });
  const edge = (name: string, required: boolean): SlotSpec => ({ tags: {}, edgeCase: name, isOpen: false, required, brief: slotBrief(i.dimensions, { tags: {}, edgeCase: name, isOpen: false }, edgeDesc.get(name)) });

  for (const c of i.cells.filter((c) => c.required)) for (let n = 0; n < c.quota; n++) out.push(cell(c.tags, true));
  for (const e of i.edgeCases.filter((e) => e.required)) for (let n = 0; n < e.quota; n++) out.push(edge(e.name, true));
  const target = Math.max(i.distinctTarget, out.length);

  const open = Math.min(Math.round(i.openSlotShare * target), target - out.length);
  for (let n = 0; n < open; n++) out.push({ tags: {}, edgeCase: null, isOpen: true, required: false, brief: slotBrief(i.dimensions, { tags: {}, edgeCase: null, isOpen: true }) });

  const fillers: SlotSpec[] = [];
  for (const c of i.cells.filter((c) => !c.required)) for (let n = 0; n < c.quota; n++) fillers.push(cell(c.tags, false));
  for (const e of i.edgeCases.filter((e) => !e.required)) for (let n = 0; n < e.quota; n++) fillers.push(edge(e.name, false));
  const combos = combinations(i.dimensions);
  for (let n = 0; out.length < target; n++) {
    if (n < fillers.length) out.push(fillers[n]!);
    else if (combos.length) out.push(cell(combos[(n - fillers.length) % combos.length]!, false));
    else if (i.edgeCases.length) out.push(edge(i.edgeCases[(n - fillers.length) % i.edgeCases.length]!.name, false));
    else out.push({ tags: {}, edgeCase: null, isOpen: true, required: false, brief: slotBrief(i.dimensions, { tags: {}, edgeCase: null, isOpen: true }) });
  }
  return out;
}

/** Two slots are identical when they fix the same tags and edge case. Open slots are never identical (null). */
export const slotSignature = (s: { tags: Record<string, string>; edgeCase: string | null; isOpen: boolean }) =>
  s.isOpen ? null : JSON.stringify([Object.entries(s.tags).sort(([a], [b]) => a.localeCompare(b)), s.edgeCase]);

/**
 * Picks the next slot for an expert (SPEC slot-based assignment): only slots whose fixed tags fit the expert's
 * approved scope, never one identical to a slot they already hold, preferring cells they have not touched and
 * required slots first. Returns null when nothing fits.
 */
export function pickSlot<S extends { id: string; tags: Record<string, string>; edgeCase: string | null; isOpen: boolean; required: boolean }>(
  available: S[],
  held: { tags: Record<string, string>; edgeCase: string | null; isOpen: boolean }[],
  scope: { jurisdictions: string[] },
): S | null {
  const heldSigs = new Set(held.map(slotSignature).filter(Boolean));
  const touched = new Set(held.flatMap((h) => [...Object.entries(h.tags).map(([k, v]) => `${k}=${v}`), ...(h.edgeCase ? [`edge=${h.edgeCase}`] : [])]));
  const fits = (s: S) => {
    const j = s.tags.jurisdiction;
    return !j || scope.jurisdictions.length === 0 || scope.jurisdictions.some((x) => x.toLowerCase() === j.toLowerCase());
  };
  const overlap = (s: S) => [...Object.entries(s.tags).map(([k, v]) => `${k}=${v}`), ...(s.edgeCase ? [`edge=${s.edgeCase}`] : [])].filter((x) => touched.has(x)).length;
  const candidates = available.filter((s) => fits(s) && (s.isOpen || !heldSigs.has(slotSignature(s))));
  candidates.sort((a, b) => Number(b.required) - Number(a.required) || overlap(a) - overlap(b) || Number(a.isOpen) - Number(b.isOpen));
  return candidates[0] ?? null;
}

/** Final coverage of a task: the slot's fixed tags plus what the author chose (open and edge-case slots). */
export interface CoverageTags {
  tags: Record<string, string>;
  edgeCase: string | null;
}

/** Minimum coverage (SPEC): every required cell and every required edge case filled at least `quota` times. */
export function coverageStatus(
  required: { cells: { tags: Record<string, string>; quota: number; required: boolean }[]; edgeCases: { name: string; quota: number; required: boolean }[] },
  accepted: CoverageTags[],
  inProgress: CoverageTags[] = [],
) {
  const covers = (t: CoverageTags, tags: Record<string, string>) => Object.entries(tags).every(([k, v]) => t.tags[k]?.toLowerCase() === v.toLowerCase());
  const hasEdge = (t: CoverageTags, name: string) => t.edgeCase?.toLowerCase() === name.toLowerCase();
  const state = (filled: number, quota: number, working: number) => (filled >= quota ? 'FILLED' : filled + working > 0 ? 'IN_PROGRESS' : 'EMPTY');
  const cells = required.cells.map((c) => {
    const filled = accepted.filter((t) => covers(t, c.tags)).length;
    const working = inProgress.filter((t) => covers(t, c.tags)).length;
    return { tags: c.tags, quota: c.quota, required: c.required, filled, working, state: state(filled, c.quota, working) };
  });
  const edgeCases = required.edgeCases.map((e) => {
    const filled = accepted.filter((t) => hasEdge(t, e.name)).length;
    const working = inProgress.filter((t) => hasEdge(t, e.name)).length;
    return { name: e.name, quota: e.quota, required: e.required, filled, working, state: state(filled, e.quota, working) };
  });
  const met = [...cells, ...edgeCases].filter((x) => x.required).every((x) => x.filled >= x.quota);
  return { cells, edgeCases, met };
}

// ───────────────────────── Task instances ─────────────────────────

export const TASK_STATUSES = ['CREATED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'ACCEPTED', 'REWORK', 'REJECTED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** Tasks that count against the concurrent open-task cap (default 3). */
export const OPEN_TASK_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'REWORK'] as const;
/** Tasks that count against the per-expert cap in a project. Rejected and reclaimed tasks do not. */
export const CAPPED_TASK_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REWORK', 'ACCEPTED'] as const;

/** Autosave: the draft output, time actively spent since the last save (capped), and the revision it was based on. */
export const SaveTaskRequest = z.object({
  output: z.record(z.string(), z.unknown()),
  activeSecondsDelta: z.number().int().min(0).max(600).default(0),
  expectedRevision: z.number().int().min(0),
});
export type SaveTaskRequest = z.infer<typeof SaveTaskRequest>;

export const SubmitTaskRequest = z.object({
  expectedRevision: z.number().int().min(0),
  /** SME tab C07 / TASK-KYC section 2: the case contains no real customer, employer or confidential information. */
  syntheticDeclaration: z.literal(true),
  /** Author explanations for synthetic-data flags, keyed by flag id. A flag without one blocks submission. */
  flagExplanations: z.record(z.string(), z.string().trim().min(1).max(500)).default({}),
});
export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequest>;

export interface TaskCheck {
  id: string;
  /** Workbench section the check belongs to (W02 to W06), so the UI can highlight it. */
  section: string;
  ok: boolean;
  message: string;
  /** Warnings never block submission. */
  severity?: 'error' | 'warning';
}

export const INVITE_DAYS = 7;
export const RECLAIM_REASONS = ['STALLED', 'AUTHOR_UNAVAILABLE', 'OTHER'] as const;
export const ReclaimRequest = z.object({ reason: z.enum(RECLAIM_REASONS), note: z.string().trim().max(500).optional() });
