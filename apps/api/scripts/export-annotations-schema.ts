import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectPolicyAnnotationsJsonSchema } from '@praxis/shared';

/** Regenerates contracts/praxis/project-policy-annotations-v1/schema.json from the shared model (a test checks it). */
const out = path.resolve(import.meta.dirname, '../../../contracts/praxis/project-policy-annotations-v1/schema.json');
writeFileSync(out, `${JSON.stringify(await projectPolicyAnnotationsJsonSchema(), null, 2)}\n`);
console.log(`wrote ${out}`);
