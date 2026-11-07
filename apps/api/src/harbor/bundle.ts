import {
  HIDDEN_GROUND_TRUTH_ROOT,
  PUBLIC_INPUT_ROOT,
  groundTruthCsv,
  instructionMd,
  isPathUnder,
  mcpMockPy,
  resolveAnswers,
  taskJson,
  testVerifiersPy,
  type BuildBundle,
  type BundleManifestEntry,
  type BundleTaskMeta,
  type HarborBlueprint,
  type HarborBundle,
  type StudioAnswers,
} from '@praxis/shared';
import { createHash } from 'node:crypto';
import { gzipDeterministic, writeTar, type TarEntry } from './tar';

/**
 * C3 Harbor bundle builder (PRD §6.3, D-20, D-21; architecture §8):
 *
 *   task.json, instruction.md, workspace/inputs/*      agent-visible
 *   environment/mcp_mock.py                            simulator (not shown to the agent)
 *   eval/ground_truth/*, eval/test_verifiers.py        hidden: verifier only
 *   solution/solve.sh, solution/ground_truth/*         hidden: oracle only (0755 for solve.sh)
 *
 * `solution/ground_truth/` is a copy of the SME's oracle table so the reference solution follows the SME's tags.
 * Callers check `studioAnswerProblems` first; the builder itself refuses unsafe paths and a missing solve.sh.
 */

export const HIDDEN_PREFIXES = ['eval/', 'solution/'] as const;

export function isHiddenPath(path: string): boolean {
  return HIDDEN_PREFIXES.some((p) => path.startsWith(p));
}

/** Allow-list for anything the agent or the SME's agent-facing preview may see (architecture §14). */
export function isAgentVisiblePath(path: string): boolean {
  return !isHiddenPath(path) && (path === 'task.json' || path === 'instruction.md' || path.startsWith('workspace/inputs/'));
}

export class BundleError extends Error {}

const enc = new TextEncoder();
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const lf = (s: string) => s.replace(/\r\n?/g, '\n');

/** Every file of the bundle, unsorted (the tar writer sorts). */
export function bundleEntries(bp: HarborBlueprint, answers: StudioAnswers, meta: BundleTaskMeta): TarEntry[] {
  const r = resolveAnswers(bp, answers);
  const file = (path: string, text: string, mode = 0o644): TarEntry => ({ path, data: enc.encode(text), mode });

  const entries: TarEntry[] = [
    file('task.json', taskJson(bp, r, meta)),
    file('instruction.md', instructionMd(bp, r)),
    file('environment/mcp_mock.py', mcpMockPy(bp, r)),
    file('eval/test_verifiers.py', testVerifiersPy(bp, r)),
  ];

  for (const z of bp.step_2_data_panels.public_dropzones) {
    if (!isPathUnder(PUBLIC_INPUT_ROOT, z.target_path)) throw new BundleError(`Dropzone "${z.id}" path must be a file under ${PUBLIC_INPUT_ROOT}`);
    entries.push(file(z.target_path.slice(1), r.inputs[z.id] ?? ''));
  }

  const gt = bp.step_2_data_panels.oracle_annotator.target_path;
  if (!isPathUnder(HIDDEN_GROUND_TRUTH_ROOT, gt)) throw new BundleError(`Oracle table path must be a file under ${HIDDEN_GROUND_TRUTH_ROOT}`);
  const table = groundTruthCsv(bp, r);
  entries.push(file(gt.slice(1), table), file(`solution/ground_truth/${gt.slice(HIDDEN_GROUND_TRUTH_ROOT.length)}`, table));

  const solve = lf(bp.authored_content.solve_sh);
  if (!solve.trim()) {
    if (bp.harbor_contract.require_solve_sh) throw new BundleError('The template has no solution/solve.sh');
  } else entries.push(file('solution/solve.sh', solve, 0o755));
  return entries;
}

/** C3: deterministic `<task>.tar.gz` with its SHA-256 and manifest (same input gives the same bytes). */
export const buildBundle: BuildBundle = (bp, answers, meta): HarborBundle => {
  const entries = bundleEntries(bp, answers, meta);
  const bytes = gzipDeterministic(writeTar(entries));
  const manifest: BundleManifestEntry[] = entries
    .map((e) => ({ path: e.path, size: e.data.length, sha256: sha256(e.data), hidden: isHiddenPath(e.path) }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  return { bytes, sha256: sha256(bytes), manifest };
};

/** The agent's view of a bundle manifest: allow-listed paths only, never `eval/*` or `solution/*` (D-21). */
export function agentView(manifest: BundleManifestEntry[]): BundleManifestEntry[] {
  return manifest.filter((e) => !e.hidden && isAgentVisiblePath(e.path));
}

/** Agent-visible files with their text, for the SME's agent-facing preview (D-21). */
export function agentVisibleFiles(bp: HarborBlueprint, answers: StudioAnswers, meta: BundleTaskMeta): { path: string; content: string }[] {
  const dec = new TextDecoder();
  return bundleEntries(bp, answers, meta)
    .filter((e) => isAgentVisiblePath(e.path))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((e) => ({ path: e.path, content: dec.decode(e.data) }));
}
