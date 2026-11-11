/**
 * Writes the cross-language WorkflowGraph v1 fixtures for Anvil:
 *   contracts/praxis/workflow-graph/fixtures/{valid,invalid}/*.json and expected.json
 * Run: pnpm --filter @praxis/api exec tsx ../../packages/shared/scripts/write-workflow-graph-fixtures.ts
 * The shared test suite fails if these files drift from the fixture module.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWorkflowGraphFixtures } from '../test/workflow-graph-fixture-files';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../contracts/praxis/workflow-graph/fixtures');
for (const [rel, body] of renderWorkflowGraphFixtures()) {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}
console.log(`Wrote fixtures to ${root}`);
