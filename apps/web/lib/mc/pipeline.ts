import type { GenerationRunDto, VerificationRunDto } from '@praxis/shared';
import type { ModelOption } from './browser';

/** Screen 3 rules that do not need a browser (S3-01 to S3-09). */

export const POLL_MS = 1500;

export const CHECK_LABELS: Record<VerificationRunDto['checks'][number]['id'], { title: string; expect: string }> = {
  '01_bundle_layout': { title: 'Harbor bundle layout', expect: 'task.json, instruction.md, eval/, solution/' },
  '02_hidden_paths': { title: 'Hidden paths not agent-visible', expect: '0 hidden paths in the agent view' },
  '03_network_internal': { title: 'Sandbox network internal', expect: '--network=internal' },
  '04_zero_baseline': { title: 'Zero-baseline (null agent)', expect: 'score 0.00' },
  '05_oracle_solve': { title: 'Oracle solve.sh', expect: 'score 1.00' },
};

export const isRunning = (s: GenerationRunDto['status'] | undefined) => s === 'QUEUED' || s === 'RUNNING';

/** S3-01: only Claude and Gemini models from the server, plus the local mock when live AI is off. Never OpenAI. */
export function modelChoices(items: ModelOption[]): ModelOption[] {
  return items.filter((m) => m.provider === 'claude' || m.provider === 'gemini' || m.provider === 'mock');
}

export const modelKey = (m: Pick<ModelOption, 'provider' | 'model'>) => `${m.provider}:${m.model}`;

/** S3-05: gates 04 (zero-baseline 0.00) and 05 (oracle 1.00) passed on a finished verification. */
export function gatesPassed(v: VerificationRunDto | null): boolean {
  if (!v || v.status !== 'SUCCEEDED') return false;
  const passed = (id: string) => v.checks.find((c) => c.id === id)?.passed === true;
  return passed('04_zero_baseline') && passed('05_oracle_solve') && v.zeroBaselineScore === 0 && v.oracleScore === 1;
}

/** S3-05: Deploy needs both gates and both selections. */
export function canDeploy(v: VerificationRunDto | null, projectId: string, smeId: string): boolean {
  return gatesPassed(v) && projectId !== '' && smeId !== '';
}

/** Why Deploy is disabled, for the hint next to the button. */
export function deployHint(v: VerificationRunDto | null, projectId: string, smeId: string): string | null {
  if (!v) return 'Run Step 2 first.';
  if (isRunning(v.status)) return 'Waiting for the checks to finish.';
  if (!gatesPassed(v)) return 'Checks 04 and 05 must pass before deploying.';
  if (!projectId) return 'Choose a project.';
  if (!smeId) return 'Choose an assigned SME.';
  return null;
}

export const usd = (n: number | null) => (n === null ? '—' : `$${n.toFixed(n < 1 ? 4 : 2)}`);
