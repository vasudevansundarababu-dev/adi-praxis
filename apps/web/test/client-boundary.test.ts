import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The client boundary (owner crash, 26 Nov 2026: "Attempted to call documentReady() from the server"). A module without
 * 'use client' runs on the server when a server component imports it, and anything it takes from a 'use client' module
 * is only a client reference there: a component can be rendered, but a plain function cannot be called. So a module
 * without 'use client' may take from a 'use client' module only components (PascalCase) and types. Pure helpers live in
 * a module without the directive (e.g. components/policy/library-logic.ts, queue-logic.ts) and both sides import them.
 */
const ROOT = resolve(__dirname, '..');
const DIRS = ['app', 'components', 'lib'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !n.endsWith('.d.ts') ? [p] : [];
  });
}

const isClient = (src: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(src);

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** Value names a module imports from each local specifier (type-only imports and `type X` names left out). */
function valueImports(src: string): { spec: string; names: string[] }[] {
  const out: { spec: string; names: string[] }[] = [];
  for (const m of src.matchAll(/import\s+(?!type\s)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[1]!;
    const names: string[] = [];
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) for (const part of braces[1]!.split(',')) {
      const t = part.trim();
      if (!t || t.startsWith('type ')) continue;
      names.push(t.split(/\s+as\s+/)[0]!.trim());
    }
    const def = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, '').trim();
    if (def && !def.startsWith('*')) names.push(def);
    out.push({ spec: m[2]!, names });
  }
  return out;
}

describe('client boundary', () => {
  it('no module without "use client" takes a plain function or value from a "use client" module', () => {
    const problems: string[] = [];
    for (const dir of DIRS) for (const f of files(join(ROOT, dir))) {
      const src = readFileSync(f, 'utf8');
      if (isClient(src)) continue;
      for (const { spec, names } of valueImports(src)) {
        const target = resolveLocal(f, spec);
        if (!target || !isClient(readFileSync(target, 'utf8'))) continue;
        for (const n of names) if (!/^[A-Z]/.test(n)) problems.push(`${f.slice(ROOT.length + 1)}: ${n} from ${spec}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the Policy page helpers load outside a client boundary and run', async () => {
    const { checklistSteps } = await import('@/components/policy/setup-checklist');
    const { documentReady } = await import('@/components/policy/library-logic');
    const doc = { id: 'd', title: 'D', jurisdiction: 'US', libraryKind: 'bank_policy', captureSourceUrl: null, captureDownloadedOn: null, effectiveFrom: '2026-01-01' };
    expect(documentReady(doc)).toBe(true);
    const steps = checklistSteps({ documents: [doc], catalog: { version: 1, catalogId: 'c', facts: 1 }, drafts: 0, draftsWithLibrary: 0, enrichment: null, counts: { rules: 0, approved: 0, excluded: 0 }, ready: 0, exports: [] });
    expect(steps[0]!.done).toBe(true);
  });
});
