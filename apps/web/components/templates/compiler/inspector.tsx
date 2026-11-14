'use client';

import { BLUEPRINT_SECTIONS, type AnvilDefinitionDto, type BlueprintSection, type GeneratedArtifacts, type SectionProblems } from '@praxis/shared';
import { useRef, useState } from 'react';
import { SECTION_TITLES, sectionNumber } from '@/lib/mc/editor';

export const INSPECTOR_TABS = [
  { id: 'uispec', label: 'UISpec.json', artifact: 'UISpec.json' },
  { id: 'prompt', label: 'Meta-Prompt', artifact: 'meta_prompt.md' },
  { id: 'pytest', label: 'Pytest & Widget Map', artifact: 'eval/test_verifiers.py' },
] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number]['id'];

/** Keyboard support for a tab list (WAI-ARIA tabs): arrows move, Home/End jump, focus follows selection. */
export function tabKey<T extends string>(e: React.KeyboardEvent, ids: readonly T[], current: T, select: (id: T) => void, vertical = false) {
  const i = ids.indexOf(current);
  const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
  const next = vertical ? 'ArrowDown' : 'ArrowRight';
  let j = -1;
  if (e.key === prev) j = (i - 1 + ids.length) % ids.length;
  else if (e.key === next) j = (i + 1) % ids.length;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = ids.length - 1;
  if (j < 0) return;
  e.preventDefault();
  select(ids[j]!);
  const list = (e.currentTarget as HTMLElement).closest('[role="tablist"]');
  (list?.querySelectorAll<HTMLElement>('[role="tab"]')[j])?.focus();
}

/** S2-10: live UISpec.json, Meta-Prompt and Pytest previews with Copy, plus the footer counters. */
export function Inspector({ artifacts, counters, initialTab = 'uispec' }: { artifacts: GeneratedArtifacts; counters: { dropzones: number; mcp: number; customFields: number }; initialTab?: InspectorTab }) {
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  const [copied, setCopied] = useState<string | null>(null);
  const pre = useRef<HTMLPreElement>(null);
  const current = INSPECTOR_TABS.find((t) => t.id === tab)!;
  const shown = artifacts[current.artifact];
  const ids = INSPECTOR_TABS.map((t) => t.id);

  return (
    <section aria-label="Inspector" className="card flex min-h-0 flex-col overflow-hidden">
      <div role="tablist" aria-label="Inspector views" className="flex border-b border-hairline text-xs">
        {INSPECTOR_TABS.map((t) => (
          <button
            key={t.id}
            id={`insp-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="insp-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => tabKey(e, ids, tab, setTab)}
            className={`flex-1 px-2 py-2 font-medium ${tab === t.id ? 'border-b-2 border-focus text-fg' : 'text-fg-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-fg-muted">
        <span className="font-mono">{current.artifact}</span>
        <button
          type="button"
          className="ml-auto rounded border border-hairline px-2 py-0.5 hover:border-focus"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shown);
              setCopied(current.label);
            } catch {
              setCopied(null);
            }
          }}
        >
          Copy
        </button>
        <span aria-live="polite" className="sr-only">
          {copied ? `${copied} copied` : ''}
        </span>
        {copied === current.label && <span aria-hidden>Copied</span>}
      </div>
      <pre id="insp-panel" ref={pre} role="tabpanel" aria-labelledby={`insp-tab-${tab}`} tabIndex={0} className="min-h-64 flex-1 overflow-auto bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre" data-testid="inspector-text">
        {shown}
      </pre>
      <p className="border-t border-hairline px-3 py-1.5 text-xs text-fg-muted" data-testid="inspector-counters">
        Dropzones {counters.dropzones} · MCP {counters.mcp} · Custom Fields {counters.customFields}
      </p>
    </section>
  );
}

/**
 * A template whose execution Anvil defines: execution, tools, rubric and environment come from Anvil's execution part,
 * not from the Harbor blueprint, so there is no "n/6 Valid" counter to show (DECISIONS.md, 13 Nov 2026). Read-only.
 */
export function AnvilDefinedSummary({ anvil }: { anvil: AnvilDefinitionDto }) {
  return (
    <div data-testid="anvil-defined">
      <p className="text-sm font-semibold">Defined by Anvil</p>
      <p className="mt-1 text-xs text-fg-muted">Execution, tools, rubric and environment come from Anvil. The blueprint stages are not checked for this template.</p>
      <dl className="mt-2 space-y-1 text-xs">
        <div>
          <dt className="text-fg-muted">Execution schema</dt>
          <dd className="font-mono break-all">{anvil.executionSchemaVersion ?? 'not stated'}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Rubric</dt>
          <dd>{anvil.rubricSummary}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Roles</dt>
          <dd className="font-mono break-all">{anvil.roleIds.length ? anvil.roleIds.join(', ') : 'none'}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * S2-07: navigator for panel 0 + 5 stages with validity badges and the "n/6 Valid" counter. For an Anvil-defined
 * template the counter and badges are replaced by the Anvil summary.
 */
export function StageNav({ problems, active, onSelect, anvil = null }: { problems: SectionProblems; active: BlueprintSection; onSelect: (s: BlueprintSection) => void; anvil?: AnvilDefinitionDto | null }) {
  const valid = BLUEPRINT_SECTIONS.filter((s) => problems[s].length === 0).length;
  return (
    <nav aria-label="Blueprint stages" className="card p-3">
      {anvil ? (
        <AnvilDefinedSummary anvil={anvil} />
      ) : (
        <p className={`text-sm font-semibold ${valid === BLUEPRINT_SECTIONS.length ? 'text-success' : 'text-fg'}`} aria-live="polite" data-testid="valid-counter">
          {valid}/{BLUEPRINT_SECTIONS.length} Valid
        </p>
      )}
      <div role="tablist" aria-orientation="vertical" aria-label="Stages" className="mt-2 flex flex-col gap-1">
        {BLUEPRINT_SECTIONS.map((s) => {
          const n = problems[s].length;
          return (
            <button
              key={s}
              id={`stage-tab-${s}`}
              type="button"
              role="tab"
              aria-selected={active === s}
              aria-controls="mc-stage-panel"
              tabIndex={active === s ? 0 : -1}
              onClick={() => onSelect(s)}
              onKeyDown={(e) => tabKey(e, BLUEPRINT_SECTIONS, active, onSelect, true)}
              className={`flex items-start gap-2 rounded-md px-2 py-2 text-left text-sm ${active === s ? 'bg-focus/15 font-semibold' : 'hover:bg-surface'}`}
            >
              <span className="mt-0.5 inline-grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line text-[11px]" aria-hidden>
                {sectionNumber(s)}
              </span>
              <span className="min-w-0 flex-1">{SECTION_TITLES[s]}</span>
              {!anvil && <span className={`pill ${n === 0 ? 'pill-success' : 'pill-warning'}`}>{n === 0 ? 'Valid' : `${n} to fix`}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
