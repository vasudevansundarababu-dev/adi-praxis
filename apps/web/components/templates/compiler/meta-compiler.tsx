'use client';

import {
  BLUEPRINT_SECTIONS,
  sectionProblems,
  validSectionCount,
  type BlueprintResponse,
  type BlueprintSection,
  type CustomField,
  type ElicitationPresetDto,
  type HarborBlueprint,
} from '@praxis/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { generateArtifacts } from '@/lib/mc/artifacts';
import { mcBrowser } from '@/lib/mc/browser';
import { customFieldCount, deleteField, fieldProblems, insertPreset, isBlueprintEqual, SECTION_TITLES, stageForSection, upsertField, type CustomFieldStage } from '@/lib/mc/editor';
import { ElicitationAssistant } from './assistant';
import { CustomFieldForm, Modal } from './custom-field-dialog';
import { inputClass, SmallButton } from './inputs';
import { Inspector, StageNav } from './inspector';
import { StageEditor } from './stage-editors';

export interface MetaCompilerProps {
  initial: BlueprintResponse;
  template: { id: string; workflowName: string; domainName: string; version: number; status: string };
  switcher: Array<{ id: string; label: string }>;
  presets: ElicitationPresetDto[];
  jobDescriptions: Array<{ id: string; title: string }>;
  /** Template whose blueprint "Reset to factory" restores (variant source or previous version); null = last saved. */
  factoryId: string | null;
  draftId: string | null;
}

type Dialog =
  | { kind: 'field'; stage: CustomFieldStage; initial: CustomField | null; originalId?: string }
  | { kind: 'variant' }
  | { kind: 'reset' }
  | null;

/** Generate → needs 6/6 valid sections and no unsaved changes (S2-17). */
export function canGenerate(validCount: number, dirty: boolean) {
  return validCount === BLUEPRINT_SECTIONS.length && !dirty;
}

/** Screen 2: Tier-1 Admin Meta-Compiler (S2-01 to S2-18). */
export function MetaCompiler({ initial, template, switcher, presets, jobDescriptions, factoryId, draftId }: MetaCompilerProps) {
  const router = useRouter();
  const [saved, setSaved] = useState<BlueprintResponse>(initial);
  const [bp, setBp] = useState<HarborBlueprint>(initial.blueprint);
  const [section, setSection] = useState<BlueprintSection>('catalog');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [conflict, setConflict] = useState<BlueprintResponse | null>(null);
  const [variantLabel, setVariantLabel] = useState('');

  const editable = saved.editable;
  const dirty = !isBlueprintEqual(bp, saved.blueprint);
  const problems = useMemo(() => sectionProblems(bp), [bp]);
  const validCount = validSectionCount(problems);
  const deferred = useDeferredValue(bp);
  const artifacts = useMemo(() => generateArtifacts(deferred, null), [deferred]);
  const activeStage = stageForSection(section);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (next: HarborBlueprint) => {
    if (!editable) return;
    setBp(next);
    setMessage(null);
  };

  async function save(expectedRevision = saved.blueprintRevision) {
    setSaving(true);
    setMessage(null);
    const r = await mcBrowser.saveBlueprint(template.id, bp, expectedRevision);
    setSaving(false);
    if (r.ok && r.data) {
      setSaved(r.data);
      setBp(r.data.blueprint);
      setConflict(null);
      setMessage({ tone: 'ok', text: `Saved revision ${r.data.blueprintRevision}.` });
      return;
    }
    if (r.status === 409 && r.code === 'BLUEPRINT_CONFLICT') {
      const latest = await mcBrowser.blueprint(template.id);
      if (latest.ok && latest.data) setConflict(latest.data);
      setMessage({ tone: 'error', text: r.error ?? 'Someone else saved a newer revision.' });
      return;
    }
    setMessage({ tone: 'error', text: r.error ?? 'Could not save.' });
  }

  async function saveVariant() {
    setSaving(true);
    const r = await mcBrowser.saveVariant(template.id, variantLabel.trim());
    setSaving(false);
    if (!r.ok || !r.data) return setMessage({ tone: 'error', text: r.error ?? 'Could not save the variant.' });
    setDialog(null);
    router.push(`/templates/${r.data.templateId}`);
  }

  async function resetToFactory() {
    setDialog(null);
    if (!factoryId) {
      setBp(saved.blueprint);
      return setMessage({ tone: 'ok', text: 'Unsaved changes discarded.' });
    }
    const r = await mcBrowser.blueprint(factoryId);
    if (!r.ok || !r.data) return setMessage({ tone: 'error', text: r.error ?? 'Could not load the factory template.' });
    const factory = r.data.blueprint;
    setBp({ ...factory, template_meta: { ...factory.template_meta, template_id: bp.template_meta.template_id, version: bp.template_meta.version } });
    setMessage({ tone: 'ok', text: 'Factory blueprint loaded. Save to keep it.' });
  }

  const stageFields = section === 'catalog' ? [] : bp.custom_fields_by_stage[section];
  const generateReady = canGenerate(validCount, dirty);

  return (
    <div className="relative left-1/2 w-[min(100vw-2rem,100rem)] -translate-x-1/2">
      <div className="card flex flex-wrap items-end gap-2 p-3" role="toolbar" aria-label="Meta-Compiler actions">
        <label className="min-w-64 text-xs font-medium">
          Template
          <select value={template.id} onChange={(e) => router.push(`/templates/${e.target.value}`)} className={inputClass}>
            {switcher.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!editable || !dirty || saving} onClick={() => save()} className="btn btn-primary !py-1.5 text-sm">
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        <button type="button" onClick={() => setDialog({ kind: 'variant' })} className="btn btn-secondary !py-1.5 text-sm">
          Save Variant
        </button>
        <button type="button" disabled={!editable} onClick={() => setDialog({ kind: 'reset' })} className="btn btn-secondary !py-1.5 text-sm">
          Reset to factory
        </button>
        <button type="button" disabled={!editable} onClick={() => setDialog({ kind: 'field', stage: activeStage, initial: null })} className="btn btn-secondary !py-1.5 text-sm">
          + Add Custom Field
        </button>
        <a href={mcBrowser.uiSpecUrl(template.id)} download className="btn btn-secondary !py-1.5 text-sm" title={dirty ? 'Exports the last saved revision' : undefined}>
          Export UISpec.json
        </a>
        <div className="ml-auto flex items-center gap-2">
          {!generateReady && (
            <span id="generate-hint" className="text-xs text-fg-muted">
              {dirty ? 'Save your changes to generate.' : `${validCount}/6 valid: fix every stage to generate.`}
            </span>
          )}
          {generateReady ? (
            <Link href={`/templates/${template.id}/generate`} className="btn btn-primary !py-1.5 text-sm">
              Generate →
            </Link>
          ) : (
            <button type="button" disabled aria-describedby="generate-hint" className="btn btn-primary !py-1.5 text-sm">
              Generate →
            </button>
          )}
        </div>
      </div>

      <div aria-live="polite">
        {message && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${message.tone === 'error' ? 'text-error' : 'text-success'}`}>
            {message.text}
          </p>
        )}
      </div>
      {conflict && (
        <div role="alert" className="mt-2 rounded-md border border-error p-3 text-sm" data-testid="conflict">
          <p className="font-medium">Revision {conflict.blueprintRevision} was saved by someone else after you opened this template.</p>
          <p className="mt-1 text-fg-muted">
            Newer revision: {conflict.validSections}/6 valid. Your unsaved changes are still here.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary !py-1 text-xs" onClick={() => { setSaved(conflict); setBp(conflict.blueprint); setConflict(null); setMessage(null); }}>
              Load revision {conflict.blueprintRevision} (discard mine)
            </button>
            <button type="button" className="btn btn-secondary !py-1 text-xs" onClick={() => void save(conflict.blueprintRevision)}>
              Overwrite with my changes
            </button>
          </div>
        </div>
      )}
      {!editable && (
        <div role="status" className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-hairline p-3 text-sm">
          <span>
            v{template.version} is {template.status.toLowerCase()}. Only a draft can be edited.
          </span>
          {draftId ? (
            <Link href={`/templates/${draftId}`} className="text-link underline">
              Open the draft
            </Link>
          ) : (
            template.status !== 'RETIRED' && <span className="text-fg-muted">Use New version to make changes.</span>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_minmax(20rem,26rem)]">
        <div className="lg:sticky lg:top-36 lg:self-start">
          <StageNav problems={problems} active={section} onSelect={setSection} />
        </div>

        <div id="mc-stage-panel" role="tabpanel" aria-labelledby={`stage-tab-${section}`} className="min-w-0 space-y-4">
          {problems[section].length > 0 && (
            <ul aria-label="Problems in this stage" className="list-disc rounded-md border border-warning p-3 pl-7 text-sm">
              {problems[section].map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <fieldset disabled={!editable} className="space-y-4">
            <legend className="sr-only">{SECTION_TITLES[section]} fields</legend>
            <StageEditor section={section} bp={bp} onChange={change} jobDescriptions={jobDescriptions} />
            {section !== 'catalog' && (
              <section className="card p-4" aria-label="Custom fields in this stage">
                <div className="flex items-center">
                  <h3 className="font-semibold">Custom fields</h3>
                  <span className="ml-auto">
                    <SmallButton onClick={() => setDialog({ kind: 'field', stage: activeStage, initial: null })}>+ Add Custom Field</SmallButton>
                  </span>
                </div>
                {stageFields.length === 0 ? (
                  <p className="mt-2 text-sm text-fg-muted">No custom fields in this stage.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-hairline">
                    {stageFields.map((f) => (
                      <li key={f.field_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <span className="font-medium">{f.label}</span>
                        <code className="text-xs text-fg-muted">{f.field_id}</code>
                        <span className="pill">{f.input_type}</span>
                        <span className="text-xs text-fg-muted">→ {f.inject_into.join(', ') || 'no target'}</span>
                        <span className="ml-auto flex gap-2">
                          <SmallButton label={`Edit ${f.label}`} onClick={() => setDialog({ kind: 'field', stage: section as CustomFieldStage, initial: f, originalId: f.field_id })}>
                            Edit
                          </SmallButton>
                          <SmallButton tone="danger" label={`Delete ${f.label}`} onClick={() => change(deleteField(bp, f.field_id))}>
                            Delete
                          </SmallButton>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </fieldset>
          <ElicitationAssistant
            presets={presets}
            disabled={!editable}
            stageLabel={`${activeStage.slice(-1)}. ${SECTION_TITLES[activeStage]}`}
            propose={(prompt) => mcBrowser.proposeField(template.id, activeStage, prompt)}
            check={(f) => fieldProblems(bp, activeStage, f)}
            onInsertPreset={(f) => change(insertPreset(bp, section, f))}
            onAccept={(f) => change(upsertField(bp, activeStage, f))}
            onEdit={(f) => setDialog({ kind: 'field', stage: activeStage, initial: f })}
            onManual={() => setDialog({ kind: 'field', stage: activeStage, initial: null })}
          />
        </div>

        <div className="lg:sticky lg:top-36 lg:self-start lg:h-[calc(100vh-10rem)]">
          <Inspector
            artifacts={artifacts}
            counters={{ dropzones: bp.step_2_data_panels.public_dropzones.length, mcp: bp.step_3_mcp_simulators.tools.length, customFields: customFieldCount(bp) }}
          />
        </div>
      </div>

      <Modal open={dialog?.kind === 'field'} onClose={() => setDialog(null)} label="Custom field">
        {dialog?.kind === 'field' && (
          <CustomFieldForm
            bp={bp}
            stage={dialog.stage}
            initial={dialog.initial}
            originalId={dialog.originalId}
            onCancel={() => setDialog(null)}
            onSave={(stage, f, originalId) => {
              change(upsertField(bp, stage, f, originalId));
              setDialog(null);
            }}
          />
        )}
      </Modal>
      <Modal open={dialog?.kind === 'variant'} onClose={() => setDialog(null)} label="Save Variant">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (variantLabel.trim()) void saveVariant();
          }}
        >
          <h2 className="text-lg font-semibold">Save Variant</h2>
          <p className="text-sm text-fg-muted">
            Creates a new workflow (draft v1) in {template.domainName} from the last saved blueprint of this template. The original is unchanged.
            {dirty && ' Your unsaved changes are not included: save first to include them.'}
          </p>
          <label className="block text-sm font-medium">
            Variant label
            <input value={variantLabel} required maxLength={200} onChange={(e) => setVariantLabel(e.target.value)} className={inputClass} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="submit" disabled={!variantLabel.trim() || saving} className="btn btn-primary">
              Save Variant
            </button>
          </div>
        </form>
      </Modal>
      <Modal open={dialog?.kind === 'reset'} onClose={() => setDialog(null)} label="Reset to factory">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Reset to factory template?</h2>
          <p className="text-sm">
            {factoryId ? 'This replaces the editor with the blueprint this draft came from.' : 'This draft has no earlier version, so the last saved revision is restored.'}{' '}
            {dirty ? 'Your unsaved changes will be lost.' : ''} Nothing is saved until you press Save.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void resetToFactory()}>
              Reset
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
