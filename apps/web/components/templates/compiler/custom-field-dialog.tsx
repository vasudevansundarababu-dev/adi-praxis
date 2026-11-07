'use client';

import { CUSTOM_FIELD_INPUT_TYPES, INJECTION_TARGETS, type CustomField, type HarborBlueprint } from '@praxis/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { coerceDefault, fieldProblems, parseList, SECTION_TITLES, uniqueFieldId, type CustomFieldStage } from '@/lib/mc/editor';
import { inputClass } from './inputs';

const STAGES: CustomFieldStage[] = ['stage_1', 'stage_2', 'stage_3', 'stage_4', 'stage_5'];
const TYPE_LABELS: Record<CustomField['input_type'], string> = {
  number_input: 'Number input',
  currency_slider: 'Currency slider',
  single_select: 'Single select',
  multi_select: 'Multi select',
  boolean_toggle: 'Boolean toggle',
  text_input: 'Text input',
};
const numeric = (t: CustomField['input_type']) => t === 'number_input' || t === 'currency_slider';
const selectType = (t: CustomField['input_type']) => t === 'single_select' || t === 'multi_select';

type Raw = string | string[] | boolean;
function rawDefault(f: CustomField): Raw {
  const d = f.default_value;
  if (Array.isArray(d) || typeof d === 'boolean') return d;
  return d === null ? (f.input_type === 'boolean_toggle' ? false : f.input_type === 'multi_select' ? [] : '') : String(d);
}

export interface CustomFieldFormProps {
  bp: HarborBlueprint;
  stage: CustomFieldStage;
  initial: CustomField | null;
  originalId?: string;
  onSave: (stage: CustomFieldStage, field: CustomField, originalId?: string) => void;
  onCancel: () => void;
}

/** S2-08: custom field with auto-slugged field_id, typed default, options and at least one inject_into target. */
export function CustomFieldForm({ bp, stage: initialStage, initial, originalId, onSave, onCancel }: CustomFieldFormProps) {
  const uid = useId();
  const [stage, setStage] = useState<CustomFieldStage>(initialStage);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [fieldId, setFieldId] = useState(initial?.field_id ?? '');
  const [idTouched, setIdTouched] = useState(Boolean(initial));
  const [type, setType] = useState<CustomField['input_type']>(initial?.input_type ?? 'text_input');
  const [optionsText, setOptionsText] = useState((initial?.options ?? []).join(', '));
  const [raw, setRaw] = useState<Raw>(initial ? rawDefault(initial) : '');
  const [min, setMin] = useState(initial?.min?.toString() ?? '');
  const [max, setMax] = useState(initial?.max?.toString() ?? '');
  const [targets, setTargets] = useState<CustomField['inject_into']>(initial?.inject_into ?? []);
  const [assertion, setAssertion] = useState(initial?.verifier_assertion ?? '');

  const options = parseList(optionsText);
  const id = idTouched ? fieldId : uniqueFieldId(bp, label, originalId);
  const field: CustomField = {
    field_id: id,
    label: label.trim(),
    input_type: type,
    options: selectType(type) ? options : [],
    default_value: coerceDefault(type, raw),
    ...(numeric(type) && min.trim() !== '' && Number.isFinite(Number(min)) ? { min: Number(min) } : {}),
    ...(numeric(type) && max.trim() !== '' && Number.isFinite(Number(max)) ? { max: Number(max) } : {}),
    inject_into: targets,
    verifier_assertion: targets.includes('eval/test_verifiers.py') ? assertion : '',
  };
  const problems = useMemo(() => (label.trim() ? fieldProblems(bp, stage, field, originalId) : ['Label is required']), [bp, stage, JSON.stringify(field), originalId, label]);

  const changeType = (t: CustomField['input_type']) => {
    setType(t);
    setRaw(t === 'boolean_toggle' ? false : t === 'multi_select' ? [] : '');
  };

  return (
    <form
      aria-labelledby={`${uid}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        if (problems.length === 0) onSave(stage, field, originalId);
      }}
      className="space-y-3"
    >
      <h2 id={`${uid}-title`} className="text-lg font-semibold">
        {initial ? 'Edit custom field' : 'Add custom field'}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Stage
          <select value={stage} onChange={(e) => setStage(e.target.value as CustomFieldStage)} className={inputClass}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s.slice(-1)}. {SECTION_TITLES[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Input type
          <select value={type} onChange={(e) => changeType(e.target.value as CustomField['input_type'])} className={inputClass}>
            {CUSTOM_FIELD_INPUT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Label
          <input value={label} required onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm font-medium">
          field_id
          <input
            value={id}
            aria-describedby={`${uid}-idhint`}
            onChange={(e) => {
              setIdTouched(true);
              setFieldId(e.target.value);
            }}
            className={`${inputClass} font-mono text-xs`}
          />
          <span id={`${uid}-idhint`} className="block text-xs font-normal text-fg-muted">
            Made from the label; unique in this template.
          </span>
        </label>
      </div>
      {selectType(type) && (
        <label className="block text-sm font-medium">
          Options
          <input value={optionsText} onChange={(e) => setOptionsText(e.target.value)} aria-describedby={`${uid}-opthint`} className={inputClass} />
          <span id={`${uid}-opthint`} className="block text-xs font-normal text-fg-muted">
            Separate options with commas.
          </span>
        </label>
      )}
      {numeric(type) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Minimum
            <input type="number" step="any" value={min} onChange={(e) => setMin(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm font-medium">
            Maximum
            <input type="number" step="any" value={max} onChange={(e) => setMax(e.target.value)} className={inputClass} />
          </label>
        </div>
      )}
      <DefaultInput type={type} options={options} raw={raw} onChange={setRaw} />
      <fieldset className="text-sm">
        <legend className="font-medium">Inject into (at least one)</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {INJECTION_TARGETS.map((t) => (
            <label key={t} className="inline-flex items-center gap-2 font-mono text-xs">
              <input type="checkbox" checked={targets.includes(t)} onChange={(e) => setTargets(e.target.checked ? [...targets, t] : targets.filter((x) => x !== t))} className="h-4 w-4" />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      {targets.includes('eval/test_verifiers.py') && (
        <label className="block text-sm font-medium">
          Verifier assertion (Python over <code>env_state</code>)
          <input value={assertion} onChange={(e) => setAssertion(e.target.value)} placeholder="env_state['weekly_cac_usd'] <= 42" className={`${inputClass} font-mono text-xs`} />
          <span className="block font-mono text-xs font-normal text-fg-muted">def test_custom_{id || 'field'}(env_state): assert …</span>
        </label>
      )}
      <div aria-live="polite">
        {problems.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-error">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={problems.length > 0} className="btn btn-primary">
          {initial ? 'Save field' : 'Add field'}
        </button>
      </div>
    </form>
  );
}

function DefaultInput({ type, options, raw, onChange }: { type: CustomField['input_type']; options: string[]; raw: Raw; onChange: (r: Raw) => void }) {
  if (type === 'boolean_toggle') {
    return (
      <label className="inline-flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={raw === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
        Default on
      </label>
    );
  }
  if (type === 'single_select') {
    return (
      <label className="block text-sm font-medium">
        Default value
        <select value={typeof raw === 'string' ? raw : ''} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">No default</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (type === 'multi_select') {
    const list = Array.isArray(raw) ? raw : [];
    return (
      <fieldset className="text-sm">
        <legend className="font-medium">Default values</legend>
        {options.length === 0 && <p className="text-xs text-fg-muted">Add options first.</p>}
        <div className="mt-1 flex flex-wrap gap-x-4">
          {options.map((o) => (
            <label key={o} className="inline-flex items-center gap-2">
              <input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} className="h-4 w-4" />
              {o}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <label className="block text-sm font-medium">
      Default value
      <input type={type === 'text_input' ? 'text' : 'number'} step="any" value={typeof raw === 'string' ? raw : ''} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </label>
  );
}

/** Native modal dialog: focus is trapped, Esc closes, focus returns to the opener. */
export function Modal({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-label={label} onClose={onClose} onCancel={onClose} className="card m-auto w-[min(40rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto p-5 text-fg backdrop:bg-black/50">
      {open && children}
    </dialog>
  );
}
