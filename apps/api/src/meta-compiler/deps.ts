import {
  defaultStudioAnswers,
  generateArtifacts,
  studioAnswerProblems,
  studioSteps,
  type BuildBundle,
  type GenerateArtifacts,
  type HarborBlueprint,
  type StudioAnswerProblems,
  type StudioAnswers,
  type StudioSteps,
} from '@praxis/shared';
import { buildBundle } from '../harbor/bundle';

/**
 * The Meta-Compiler functions the API calls (contract: packages/shared/src/blueprint/contract.ts). They are injected so
 * tests can substitute fakes, but every default is the real implementation:
 *
 *   generate / studioSteps / studioAnswerProblems   packages/shared (C1, C2: escaped, deterministic, stdlib-only Python)
 *   buildBundle                                     apps/api/src/harbor/bundle.ts (C3: path-checked, hidden eval/solution,
 *                                                   judge files, ustar long names, deterministic gzip)
 *
 * Until 20 Nov 2026 the defaults were TEMPORARY placeholders whose verifiers were `assert True` with no reward file, so
 * every real (docker / sandbox job) grading run scored 0.00 and SME dropzone paths were not validated. Keep it that
 * way: there is deliberately no placeholder left to fall back to (see `assertRealDeps`).
 */
export interface MetaCompilerDeps {
  generate: GenerateArtifacts;
  studioSteps: StudioSteps;
  studioAnswerProblems: StudioAnswerProblems;
  buildBundle: BuildBundle;
}

export const realDeps: MetaCompilerDeps = Object.freeze({ generate: generateArtifacts, studioSteps, studioAnswerProblems, buildBundle });

/**
 * The synthetic payload a verification run injects (S3-04): every control at its blueprint default. One definition for
 * the API, the catalog proof (prisma/catalog/verify-docker.ts) and the CI grading e2e, so all three grade the same bundle.
 */
export function defaultAnswers(bp: HarborBlueprint): StudioAnswers {
  return defaultStudioAnswers(bp);
}

/** Real implementations, with test overrides on top. Production passes no overrides. */
export function resolveDeps(overrides: Partial<MetaCompilerDeps> = {}): MetaCompilerDeps {
  return { ...realDeps, ...overrides };
}

/**
 * Startup check for deployed processes: a real grading runner (docker or the sandbox job) must never be paired with
 * substituted generators, or verification scores stop meaning anything. Overrides are for tests with the mock runner.
 */
export function assertRealDeps(deps: MetaCompilerDeps, runnerKind: 'mock' | 'docker' | 'job'): void {
  if (runnerKind === 'mock') return;
  const swapped = (Object.keys(realDeps) as (keyof MetaCompilerDeps)[]).filter((k) => deps[k] !== realDeps[k]);
  if (swapped.length) throw new Error(`Meta-Compiler: HARBOR_RUNNER=${runnerKind} needs the real ${swapped.join(', ')} (overrides are for tests with the mock runner)`);
}
