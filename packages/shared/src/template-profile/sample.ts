import { emptyOutput, isArrayType, itemFieldsOf, setFieldValue, type ItemField } from './helpers';
import type { SectionKey, TemplateProfile } from './schema';

/**
 * A complete, deterministic, obviously synthetic output for a profile: every field filled, criteria bound to the
 * first outcome field, weights totalling 100. For tests and demos only; never an example answer shown to authors.
 * Private values carry a `PRIVATE-` canary so projection tests can prove they never reach the agent.
 */
export function sampleProfileOutput(profile: TemplateProfile): Record<string, unknown> {
  const outcome = profile.sections.find((s) => s.key === 'S6')!.fields.find((f) => f.outputField)!;
  const outcomeValue = outcome.options?.[0]?.value ?? '1';
  const canary = (vis: string | undefined) => (vis === 'private_reference' ? 'PRIVATE-REF ' : vis === 'private_rubric' ? 'PRIVATE-RUBRIC ' : '');

  const value = (f: ItemField, vis: string | undefined, n: number, context: string): unknown => {
    const v = f.visibility && f.visibility !== 'author_and_agent' ? f.visibility : vis;
    switch (f.type) {
      case 'text':
      case 'long_text':
      case 'graph_binding':
        if (f.key === 'id') return `${f.idPrefix ?? 'X'}${n}`;
        return `${canary(v)}${f.label} (synthetic sample)`;
      case 'date':
        return '2026-05-01';
      case 'number':
        return Math.max(f.min ?? 1, Math.min(f.max ?? 3, 3));
      case 'pick_list':
        return f.options?.[0]?.value ?? `${canary(v)}${f.label}`;
      case 'multi_select':
        return f.options?.length ? [f.options[0]!.value] : [`${canary(v)}${f.label} (synthetic sample)`];
      case 'flag':
        return true;
      default: {
        if (!isArrayType(f.type)) return null;
        const subs = itemFieldsOf(f);
        const prefix = f.idPrefix ?? (f.type === 'evidence_record' ? 'E' : f.type === 'tool_call' ? 'R' : f.type === 'criterion' ? 'C' : f.type === 'policy_citation' ? 'PR' : 'X');
        const item: Record<string, unknown> = {};
        for (const s of subs) item[s.key] = s.key === 'id' ? `${prefix}1` : value(s, v, 1, `${context}.${f.key}`);
        if (f.type === 'criterion') Object.assign(item, { weight: 100, critical: true, outputField: outcome.outputField, comparison: 'json_equals', expectedValue: outcomeValue });
        if (f.type === 'policy_citation') Object.assign(item, { ruleId: 'PR1', outputField: 'gap_count', comparison: 'json_number_max', expectedValue: '5', hardFailure: true });
        if (f.type === 'tool_call') Object.assign(item, { tool: f.options?.[0]?.value ?? 'record_lookup' });
        if (f.key === 'decisionFields') Object.assign(item, { name: 'gap_count', valueType: 'number', allowedValues: [], referenceValue: '2' });
        if (f.key === 'commonErrors') item.caughtBy = 'C1';
        return [item];
      }
    }
  };

  let out: Record<string, unknown> = emptyOutput(profile);
  for (const s of profile.sections)
    for (const f of s.fields) {
      let v = value(f, f.visibility, 1, s.key);
      if (s.key === 'S3' && f.key === 'environment') v = 'none';
      out = setFieldValue(profile, out, s.key as SectionKey, f.key, v);
    }
  return out;
}
