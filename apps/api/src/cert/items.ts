import type { ItemFamily, Prisma } from '@prisma/client';
import { AnswerRule, canonicalVariables, deriveKey, isCorrect, isWritten, rng, sampleVariables, VariableSchema, type Key } from '@praxis/shared';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db';
import { sha256 } from '../lib/crypto';
import type { SecretBox } from '../lib/secrets';
import type { EmbeddingProvider } from '../tasks/embeddings';
import { toVectorLiteral } from '../tasks/embeddings';
import type { CurriculumGenerator, FamilyRef, InstanceContent, Section } from './generator';

/**
 * Dynamic, equivalent test forms (docs/SME-SUPPLY.md section 7.3). Every instance is instantiated with fresh variables,
 * its key is derived by the family's rule, and it is served only if it passes four checks:
 *   1. rule: the platform derives the key from the variables (never the model);
 *   2. solver: an independent model call, without the key, reaches the same answer;
 *   3. citation: the cited guideline section supports that answer;
 *   4. difficulty: the solver's difficulty estimate falls in the family's band.
 * Near-copies of earlier instances (same variables, or embedding similarity ≥ NEAR_COPY) are discarded. A family whose
 * instances keep failing is flagged for review and no longer used.
 */
export const NEAR_COPY = 0.97;
export const MAX_TRIES = 3;
export const FLAG_AFTER = 5;

export const familyRef = (f: ItemFamily): FamilyRef => ({
  id: f.id,
  competency: f.competency,
  difficultyMin: f.difficultyMin,
  difficultyMax: f.difficultyMax,
  cognitiveLevel: f.cognitiveLevel,
  itemType: f.itemType as FamilyRef['itemType'],
  stemPattern: f.stemPattern,
  variableSchema: VariableSchema.parse(f.variableSchema),
  answerRule: AnswerRule.parse(f.answerRule),
  options: f.options,
  distractorRationale: f.distractorRationale,
  citation: f.citation,
  critical: f.critical,
});

type Stats = { served?: number; correct?: number; validationFailures?: number; consecutiveFailures?: number };

export interface ItemDeps {
  db: Db;
  gen: CurriculumGenerator;
  box: SecretBox;
  embeddings: EmbeddingProvider;
}

async function bumpFailure(db: Db, f: ItemFamily, reason: string) {
  const stats = (f.stats ?? {}) as Stats;
  const consecutive = (stats.consecutiveFailures ?? 0) + 1;
  const flag = consecutive >= FLAG_AFTER && f.status !== 'FLAGGED';
  await db.itemFamily.update({ where: { id: f.id }, data: { stats: { ...stats, validationFailures: (stats.validationFailures ?? 0) + 1, consecutiveFailures: consecutive } as Prisma.InputJsonValue, ...(flag ? { status: 'FLAGGED' } : {}) } });
  if (flag) {
    await db.auditEvent.create({ data: { clientId: f.clientId, actorType: 'SYSTEM', actorId: 'cert-generator', entityType: 'ItemFamily', entityId: f.id, action: 'cert.family_flagged', after: { reason, consecutiveFailures: consecutive } } });
  }
  return flag;
}

/**
 * Generates and validates one instance of a family. Returns the stored instance id, or null when every try failed
 * (the family's failure counters go up, and it is flagged after FLAG_AFTER consecutive failures).
 */
export async function generateInstance(deps: ItemDeps, familyId: string, sections: Section[], opts: { status: 'VALID' | 'SAMPLE'; seed?: string }) {
  const { db, gen, box, embeddings } = deps;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const f = await db.itemFamily.findUniqueOrThrow({ where: { id: familyId } });
    if (f.status === 'FLAGGED' || f.status === 'REJECTED') return null;
    const ref = familyRef(f);
    const vars = sampleVariables(ref.variableSchema, rng(`${opts.seed ?? randomUUID()}:${attempt}`));
    const fingerprint = sha256(`${f.id}|${canonicalVariables(vars)}`);
    if (await db.itemInstance.findUnique({ where: { familyId_fingerprint: { familyId: f.id, fingerprint } } })) continue; // same variables as an earlier instance

    // Check 1: the key comes from the rule.
    let key: Key;
    try {
      key = deriveKey(ref.answerRule, vars);
    } catch {
      key = null;
    }
    const written = isWritten(ref.itemType);
    const ruleOk = written ? ref.answerRule.kind === 'written' : key !== null && (!['SINGLE_CHOICE', 'SEVERITY', 'LABEL'].includes(ref.itemType) || ref.options.includes(key as string));

    const { stem, content } = await gen.writeInstance(ref, vars);
    const section = sections.find((s) => s.anchor === ref.citation);
    const guideline = section ? `[${section.anchor}] ${section.heading}\n${section.text}` : '';
    // Check 2: independent solve without the key (written items are graded by people, so there is no key to match).
    const solved = written ? { answer: null, difficulty: Math.round((ref.difficultyMin + ref.difficultyMax) / 2) } : await gen.solve({ itemType: ref.itemType, stem, content }, guideline);
    const solverOk = written || isCorrect(ref.itemType, key, solved.answer);
    // Check 3: the cited section exists and supports the answer.
    const citationOk = !!section && (await gen.supports({ stem, content, key }, guideline));
    // Check 4: difficulty in band.
    const difficultyOk = solved.difficulty >= ref.difficultyMin && solved.difficulty <= ref.difficultyMax;

    // Near-copy of an instance already generated for this family.
    const vector = await embeddings.embed(stem);
    const literal = toVectorLiteral(vector);
    const near = await db.$queryRaw<{ score: number }[]>`SELECT 1 - (embedding <=> ${literal}::vector) AS score FROM "ItemInstance" WHERE family_id = ${f.id}::uuid AND status IN ('VALID', 'SAMPLE') AND embedding IS NOT NULL ORDER BY embedding <=> ${literal}::vector LIMIT 1`;
    const nearCopy = !!near[0] && Number(near[0].score) >= NEAR_COPY;

    const validation = { rule: ruleOk, solver: solverOk, citation: citationOk, difficulty: difficultyOk, estimatedDifficulty: solved.difficulty, nearCopy, model: gen.bulkModel, attempt };
    const ok = ruleOk && solverOk && citationOk && difficultyOk && !nearCopy;
    const row = await db.itemInstance.create({
      data: { clientId: f.clientId, familyId: f.id, variables: vars as Prisma.InputJsonValue, fingerprint, stem, content: content as unknown as Prisma.InputJsonValue, keyEnc: box.encrypt(JSON.stringify(key)), validation: validation as Prisma.InputJsonValue, status: ok ? opts.status : 'DISCARDED' },
    });
    await db.$executeRaw`UPDATE "ItemInstance" SET embedding = ${literal}::vector WHERE id = ${row.id}::uuid`;
    if (ok) {
      const stats = (f.stats ?? {}) as Stats;
      if (stats.consecutiveFailures) await db.itemFamily.update({ where: { id: f.id }, data: { stats: { ...stats, consecutiveFailures: 0 } as Prisma.InputJsonValue } });
      return row.id;
    }
    const failed = Object.entries({ rule: ruleOk, solver: solverOk, citation: citationOk, difficulty: difficultyOk }).filter(([, v]) => !v).map(([k]) => k);
    if (await bumpFailure(db, f, nearCopy ? 'near-copy' : failed.join(','))) return null;
  }
  return null;
}

export const keyOf = (box: SecretBox, keyEnc: string): Key => JSON.parse(box.decrypt(keyEnc)) as Key;

/** Largest-remainder split of the item count across competencies by weight. */
export function splitByWeight(count: number, competencies: { key: string; weight: number }[]) {
  const total = competencies.reduce((n, c) => n + c.weight, 0) || 1;
  const raw = competencies.map((c) => ({ key: c.key, exact: (count * c.weight) / total }));
  const out = raw.map((r) => ({ key: r.key, n: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let left = count - out.reduce((n, o) => n + o.n, 0);
  for (const o of [...out].sort((a, b) => b.rem - a.rem)) {
    if (left-- <= 0) break;
    o.n++;
  }
  return Object.fromEntries(out.map((o) => [o.key, o.n]));
}

/**
 * Assembles one form for a blueprint: per competency, the weighted number of items, drawn from approved families (the
 * Expert authoring task separately), each a freshly generated and validated instance. Buffered for single use.
 */
export async function assembleForm(deps: ItemDeps, blueprintId: string, sections: Section[]) {
  const { db } = deps;
  const bp = await db.certificationBlueprint.findUniqueOrThrow({ where: { id: blueprintId } });
  const competencies = bp.competencies as { key: string; weight: number }[];
  const families = await db.itemFamily.findMany({ where: { blueprintId, status: 'APPROVED' } });
  const authoring = families.filter((f) => f.itemType === 'AUTHORING');
  const regular = families.filter((f) => f.itemType !== 'AUTHORING');
  const need = splitByWeight(bp.itemCount, competencies);
  const itemIds: string[] = [];
  const pick = rng(randomUUID());
  for (const c of competencies) {
    const pool = regular.filter((f) => f.competency === c.key);
    if (!pool.length && need[c.key]) throw new Error(`No approved item family for competency "${c.key}"`);
    for (let i = 0; i < (need[c.key] ?? 0); i++) {
      // Try the families of this competency in a random order until one yields a valid instance.
      const order = [...pool].sort(() => pick() - 0.5);
      let id: string | null = null;
      for (const f of order) {
        id = await generateInstance(deps, f.id, sections, { status: 'VALID' });
        if (id) break;
      }
      if (!id) throw new Error(`Could not generate a valid item for competency "${c.key}"`);
      itemIds.push(id);
    }
  }
  if (bp.authoringTask) {
    if (!authoring.length) throw new Error('The blueprint needs an approved authoring-task family');
    const id = await generateInstance(deps, authoring[Math.floor(pick() * authoring.length)]!.id, sections, { status: 'VALID' });
    if (!id) throw new Error('Could not generate the authoring task');
    itemIds.push(id);
  }
  return db.testForm.create({ data: { clientId: bp.clientId, blueprintId, itemIds } });
}

/** Keeps a small buffer of pre-validated forms for each published blueprint, so starting a test never waits. */
export const BUFFER_SIZE = 2;
export async function refillBuffers(deps: ItemDeps, sectionsOf: (versionId: string) => Promise<Section[]>) {
  const { db } = deps;
  const versions = await db.guidelinesVersion.findMany({ where: { status: 'PUBLISHED' }, include: { blueprints: true } });
  let made = 0;
  for (const v of versions) {
    for (const bp of v.blueprints.filter((b) => v.publishedTiers.includes(b.tier) && b.status === 'APPROVED')) {
      const have = await db.testForm.count({ where: { blueprintId: bp.id, status: 'BUFFERED' } });
      for (let i = have; i < BUFFER_SIZE; i++) {
        try {
          await assembleForm(deps, bp.id, await sectionsOf(v.id));
          made++;
        } catch {
          break;
        }
      }
    }
  }
  return made;
}

export type { InstanceContent };
