import { zodToJsonSchema } from 'zod-to-json-schema';
import { HarborBlueprint } from './schema';

/** JSON Schema for UISpec.json import and export (D-01, D-03). Describes the parsed (complete) blueprint. */
export function blueprintJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(HarborBlueprint, { name: 'HarborBlueprint', target: 'jsonSchema7', $refStrategy: 'none', effectStrategy: 'input' }) as Record<string, unknown>;
}
