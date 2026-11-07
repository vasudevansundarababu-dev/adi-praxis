import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import type { EventHandler } from '../outbox/handlers';
import type { MetaCompilerDeps } from './deps';
import type { DrafterFactory } from './drafter';
import { processGeneration } from './generation';

export interface MetaCompilerWorkerDeps {
  config: Config;
  storage: ObjectStorage;
  drafters: DrafterFactory;
  deps: MetaCompilerDeps;
}

/** Worker jobs for Screens 3 and 4. Each is a `run` handler: slow work outside a transaction, idempotent itself. */
export function metaCompilerHandlers(w: MetaCompilerWorkerDeps): EventHandler[] {
  const payload = (e: { payload: unknown }) => e.payload as Record<string, string>;
  return [
    { name: 'meta-compiler.generate', event: 'compiler.generation_requested', run: (e, db: Db) => processGeneration({ ...w, db }, payload(e).runId!) },
  ];
}

/** Test and wiring overrides for the Meta-Compiler (AppDeps.metaCompiler). Defaults follow config. */
export interface MetaCompilerOverrides {
  drafters?: DrafterFactory;
  deps?: Partial<MetaCompilerDeps>;
}
