import type { GenerateArtifacts, GeneratedArtifacts } from '../contract';
import { resolveAnswers } from './answers';
import { instructionMd, metaPromptMd, taskJson, uiSpecJson } from './documents';
import { mcpMockPy } from './mcp-mock';
import { testVerifiersPy } from './verifiers';

export { allCustomFields, defaultStudioAnswers, fieldsFor, resolveAnswers, type ResolvedAnswers } from './answers';
export { groundTruthCsv, instructionMd, metaPromptMd, TASK_JSON_SCHEMA, taskJson, uiSpecJson } from './documents';
export { stableJson } from './escape';
export { HARBOR_RUNTIME, mcpMockPy } from './mcp-mock';
export { ruleSummary, testVerifiersPy } from './verifiers';

/** C1: every generated artifact for a blueprint. Pure and deterministic; `answers: null` uses the blueprint defaults. */
export const generateArtifacts: GenerateArtifacts = (bp, answers): GeneratedArtifacts => {
  const r = resolveAnswers(bp, answers);
  return {
    'UISpec.json': uiSpecJson(bp),
    'meta_prompt.md': metaPromptMd(bp),
    'instruction.md': instructionMd(bp, r),
    'task.json': taskJson(bp, r),
    'environment/mcp_mock.py': mcpMockPy(bp, r),
    'eval/test_verifiers.py': testVerifiersPy(bp, r),
  };
};
