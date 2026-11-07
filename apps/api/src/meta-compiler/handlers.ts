import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import type { EventHandler } from '../outbox/handlers';
import type { MetaCompilerDeps } from './deps';
import type { DrafterFactory } from './drafter';
import { processGeneration } from './generation';
import type { LlmJudge } from './judge';
import { processTaskJudge } from './judge-task';
import { processAuthoredTaskVerification } from './task-verification';
import { processVerification } from './verification';
import type { HarborRunner } from '../harbor/runner';

export interface MetaCompilerWorkerDeps {
  config: Config;
  storage: ObjectStorage;
  drafters: DrafterFactory;
  deps: MetaCompilerDeps;
  runner: HarborRunner;
  judge: LlmJudge;
}

/** Worker jobs for Screens 3 and 4. Each is a `run` handler: slow work outside a transaction, idempotent itself. */
export function metaCompilerHandlers(w: MetaCompilerWorkerDeps): EventHandler[] {
  const payload = (e: { payload: unknown }) => e.payload as Record<string, string>;
  return [
    { name: 'meta-compiler.generate', event: 'compiler.generation_requested', run: (e, db: Db) => processGeneration({ ...w, db }, payload(e).runId!) },
    { name: 'meta-compiler.verify', event: 'compiler.verification_requested', run: (e, db: Db) => processVerification({ ...w, db }, payload(e).verificationId!) },
    { name: 'meta-compiler.verify-task', event: 'studio.task_committed', run: (e, db: Db) => processAuthoredTaskVerification({ ...w, db }, payload(e).authoredTaskId!) },
    { name: 'meta-compiler.judge-task', event: 'studio.task_verified', run: (e, db: Db) => processTaskJudge({ ...w, db }, payload(e).authoredTaskId!) },
  ];
}

/** Test and wiring overrides for the Meta-Compiler (AppDeps.metaCompiler). Defaults follow config. */
export interface MetaCompilerOverrides {
  drafters?: DrafterFactory;
  deps?: Partial<MetaCompilerDeps>;
  runner?: HarborRunner;
  judge?: LlmJudge;
  /** Test-only fault injection for Save & Commit. */
  studioFaults?: { afterUpload?: () => Promise<void>; beforeRecord?: () => Promise<void> };
}
