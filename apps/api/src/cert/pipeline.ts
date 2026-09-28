import type { Prisma } from '@prisma/client';
import { ruleProblems, SME_TIERS, TIER_DEFAULTS, type SmeTier } from '@praxis/shared';
import { createHash } from 'node:crypto';
import { extractSourceText } from '../tasks/drafting/source-text';
import type { ObjectStorage } from '../candidate/storage';
import type { Db, Tx } from '../db';
import { AppError } from '../lib/errors';
import type { EventHandler } from '../outbox/handlers';
import { generateInstance, type ItemDeps } from './items';
import { GeneratorUnavailableError, PROMPT_VERSIONS, type Section } from './generator';

/**
 * Guidelines → knowledge map → course, blueprint and item families per tier (docs/SME-SUPPLY.md section 7.1), as
 * worker jobs. Everything generated cites a section of this guidelines version; uncited output is dropped. Nothing is
 * served until an Admin approves it and publishes the tier.
 */
export const SAMPLES_PER_FAMILY = 3;

/** Splits guideline text into cited sections: Markdown headings, numbered headings, or paragraph groups. */
export function splitSections(text: string): Section[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const heading = (l: string) => {
    const md = l.match(/^#{1,6}\s+(.{2,120})$/);
    if (md) return md[1]!.trim();
    const num = l.match(/^(\d+(?:\.\d+)*\.?)\s+([A-Z][^.!?]{2,100})$/);
    if (num) return `${num[1]} ${num[2]}`.trim();
    return null;
  };
  const out: { heading: string; body: string[] }[] = [];
  for (const l of lines) {
    const h = heading(l.trim());
    if (h) out.push({ heading: h, body: [] });
    else if (l.trim()) (out.at(-1) ?? (out.push({ heading: 'Introduction', body: [] }), out.at(-1)!)).body.push(l.trim());
  }
  let sections = out.filter((s) => s.body.join(' ').length >= 20);
  if (sections.length < 2) {
    // No headings: group paragraphs into sections of about 1,200 characters.
    const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 20);
    sections = [];
    let cur: string[] = [];
    for (const p of paras) {
      cur.push(p);
      if (cur.join(' ').length > 1200) (sections.push({ heading: p.slice(0, 60), body: cur }), (cur = []));
    }
    if (cur.length) sections.push({ heading: cur[0]!.slice(0, 60), body: cur });
  }
  return sections.slice(0, 80).map((s, i) => ({ anchor: `S${i + 1}`, heading: s.heading, text: s.body.join('\n').slice(0, 8000) }));
}

export async function sectionsOf(db: Db | Tx, versionId: string): Promise<Section[]> {
  const v = await db.guidelinesVersion.findUniqueOrThrow({ where: { id: versionId } });
  return v.sections as unknown as Section[];
}

/** Admin uploads a version: text extracted, split into sections, stored privately, and a generation run queued. */
export async function ingestVersion(
  tx: Tx,
  storage: ObjectStorage,
  args: { clientId: string; packageId: string; fileName: string; buf: Buffer; major: boolean; userId: string },
  emit: (e: { name: 'guidelines.generate'; aggregateType: string; aggregateId: string; payload: Record<string, unknown> }) => Promise<void>,
) {
  let text: string;
  const md = /\.(md|markdown)$/i.test(args.fileName);
  if (md) text = args.buf.toString('utf8');
  else text = (await extractSourceText(args.buf)).text;
  const sections = splitSections(text);
  if (sections.length === 0 || text.length < 200) throw new AppError(422, 'GUIDELINES_TOO_SHORT', 'These guidelines are too short to generate a course and certification from.');
  const last = await tx.guidelinesVersion.findFirst({ where: { packageId: args.packageId }, orderBy: { version: 'desc' } });
  const version = (last?.version ?? 0) + 1;
  const key = `guidelines/${args.packageId}/v${version}-${Date.now()}`;
  await storage.put(key, args.buf, md ? 'text/markdown' : 'application/octet-stream');
  const v = await tx.guidelinesVersion.create({
    data: { clientId: args.clientId, packageId: args.packageId, version, major: args.major, fileName: args.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 200), storageKey: key, sha256: createHash('sha256').update(args.buf).digest('hex'), sections: sections as unknown as Prisma.InputJsonValue, createdById: args.userId },
  });
  const run = await tx.generationRun.create({ data: { clientId: args.clientId, versionId: v.id, scope: 'FULL', createdById: args.userId } });
  await emit({ name: 'guidelines.generate', aggregateType: 'GenerationRun', aggregateId: run.id, payload: { runId: run.id } });
  return { version: v, run };
}

const validAnchors = (sections: Section[]) => new Set(sections.map((s) => s.anchor));

async function storeCourse(db: Db, deps: ItemDeps, versionId: string, clientId: string, tier: SmeTier, sections: Section[]) {
  const knowledge = await db.knowledgeItem.findMany({ where: { versionId, status: { not: 'REJECTED' } } });
  const k = knowledge.map((x) => ({ kind: x.kind as never, text: x.text, citation: x.citation, critical: x.critical }));
  const c = await deps.gen.writeCourse(tier, k, sections);
  const anchors = validAnchors(sections);
  const modules = c.modules.map((m) => ({ ...m, citations: m.citations.filter((a) => anchors.has(a)), quiz: m.quiz.filter((q) => q.answerIndex < q.options.length) })).filter((m) => m.citations.length && m.quiz.length);
  if (!modules.length) throw new GeneratorUnavailableError(`The ${tier} course had no cited modules`);
  await db.$transaction(async (tx) => {
    const old = await tx.course.findUnique({ where: { versionId_tier: { versionId, tier } } });
    if (old) {
      await tx.courseModule.deleteMany({ where: { courseId: old.id } });
      await tx.course.delete({ where: { id: old.id } });
    }
    const course = await tx.course.create({ data: { clientId, versionId, tier, title: c.title, model: deps.gen.model, promptVersion: PROMPT_VERSIONS.course } });
    for (const [i, m] of modules.entries()) {
      await tx.courseModule.create({ data: { clientId, courseId: course.id, position: i + 1, title: m.title, explanation: m.explanation, goodExamples: m.goodExamples, badExamples: m.badExamples, quiz: m.quiz as Prisma.InputJsonValue, practice: m.practice as Prisma.InputJsonValue, citations: m.citations } });
    }
  });
}

async function storeBlueprintAndFamilies(db: Db, deps: ItemDeps, versionId: string, clientId: string, tier: SmeTier, sections: Section[], only: 'BLUEPRINT' | 'FAMILIES' | 'BOTH') {
  const knowledge = (await db.knowledgeItem.findMany({ where: { versionId, status: { not: 'REJECTED' } } })).map((x) => ({ kind: x.kind as never, text: x.text, citation: x.citation, critical: x.critical }));
  const anchors = validAnchors(sections);
  const d = TIER_DEFAULTS[tier];
  let bp = await db.certificationBlueprint.findUnique({ where: { versionId_tier: { versionId, tier } } });
  if (only !== 'FAMILIES' || !bp) {
    const comps = (await deps.gen.writeBlueprint(tier, knowledge)).map((c) => ({ ...c, citations: c.citations.filter((a) => anchors.has(a)) })).filter((c) => c.citations.length);
    if (!comps.length) throw new GeneratorUnavailableError(`The ${tier} blueprint had no cited competencies`);
    const sum = comps.reduce((n, c) => n + c.weight, 0);
    // Weights normalised to 100 (largest remainder).
    const scaled = comps.map((c) => ({ ...c, weight: Math.floor((c.weight * 100) / sum) }));
    scaled[0]!.weight += 100 - scaled.reduce((n, c) => n + c.weight, 0);
    const data = { competencies: scaled as Prisma.InputJsonValue, itemCount: d.itemCount, authoringTask: d.authoringTask, timeLimitMinutes: d.timeLimitMinutes, passRules: d.passRules as Prisma.InputJsonValue, status: 'DRAFT', model: deps.gen.model, approvedById: null, approvedAt: null };
    if (bp) {
      await db.itemFamily.updateMany({ where: { blueprintId: bp.id, status: { not: 'REJECTED' } }, data: { status: 'REJECTED' } });
      bp = await db.certificationBlueprint.update({ where: { id: bp.id }, data });
    } else bp = await db.certificationBlueprint.create({ data: { clientId, versionId, tier, ...data } });
    if (only === 'BLUEPRINT') return bp;
  } else {
    await db.itemFamily.updateMany({ where: { blueprintId: bp.id, status: { in: ['DRAFT', 'FLAGGED'] } }, data: { status: 'REJECTED' } });
  }
  const comps = bp.competencies as { key: string; name: string; weight: number; citations: string[] }[];
  const families = await deps.gen.writeFamilies(tier, comps, knowledge, sections);
  let kept = 0;
  for (const f of families) {
    if (!comps.some((c) => c.key === f.competency) || !anchors.has(f.citation) || ruleProblems(f.answerRule, f.variableSchema, f.options).length || f.difficultyMin > f.difficultyMax) continue;
    const row = await db.itemFamily.create({
      data: { clientId, blueprintId: bp.id, competency: f.competency, difficultyMin: f.difficultyMin, difficultyMax: f.difficultyMax, cognitiveLevel: f.cognitiveLevel, itemType: f.itemType, stemPattern: f.stemPattern, variableSchema: f.variableSchema as Prisma.InputJsonValue, answerRule: f.answerRule as Prisma.InputJsonValue, options: f.options, distractorRationale: f.distractorRationale, citation: f.citation, critical: f.critical, model: deps.gen.model },
    });
    kept++;
    for (let i = 0; i < SAMPLES_PER_FAMILY; i++) await generateInstance(deps, row.id, sections, { status: 'SAMPLE' });
  }
  if (!kept) throw new GeneratorUnavailableError(`No valid item families for the ${tier} tier`);
  return bp;
}

/** Runs one generation run: the full pipeline, or one stage/artifact for a regeneration. */
export async function executeRun(db: Db, deps: ItemDeps, runId: string) {
  const run = await db.generationRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'QUEUED') return;
  const claimed = await db.generationRun.updateMany({ where: { id: run.id, status: 'QUEUED' }, data: { status: 'RUNNING' } });
  if (!claimed.count) return;
  const v = await db.guidelinesVersion.findUniqueOrThrow({ where: { id: run.versionId } });
  const sections = v.sections as unknown as Section[];
  const target = run.target as { tier?: SmeTier; familyId?: string };
  const before = { ...deps.gen.usage };
  const stage = (s: string) => db.generationRun.update({ where: { id: run.id }, data: { stage: s } });
  try {
    const tiers = target.tier ? [target.tier] : [...SME_TIERS];
    if (run.scope === 'FULL' || run.scope === 'KNOWLEDGE') {
      await stage('KNOWLEDGE');
      const anchors = validAnchors(sections);
      // Items with no valid citation are dropped.
      const items = (await deps.gen.extractKnowledge(sections)).filter((k) => anchors.has(k.citation));
      if (!items.length) throw new GeneratorUnavailableError('No cited knowledge could be extracted');
      await db.knowledgeItem.deleteMany({ where: { versionId: v.id } });
      await db.knowledgeItem.createMany({ data: items.map((k) => ({ clientId: v.clientId, versionId: v.id, kind: k.kind, text: k.text, citation: k.citation, critical: k.critical, model: deps.gen.model })) });
    }
    if (run.scope === 'FULL' || run.scope === 'COURSE') {
      for (const t of tiers) {
        await stage(`COURSE:${t}`);
        await storeCourse(db, deps, v.id, v.clientId, t, sections);
      }
    }
    if (run.scope === 'FULL' || run.scope === 'BLUEPRINT' || run.scope === 'FAMILIES') {
      for (const t of tiers) {
        await stage(`${run.scope === 'FAMILIES' ? 'FAMILIES' : 'BLUEPRINT'}:${t}`);
        await storeBlueprintAndFamilies(db, deps, v.id, v.clientId, t, sections, run.scope === 'FULL' ? 'BOTH' : run.scope === 'BLUEPRINT' ? 'BOTH' : 'FAMILIES');
      }
    }
    if (run.scope === 'SAMPLE' && target.familyId) {
      await stage('SAMPLE');
      if (!(await generateInstance(deps, target.familyId, sections, { status: 'SAMPLE' }))) throw new GeneratorUnavailableError('The sample failed validation; see the family’s failure count');
    }
    const u = deps.gen.usage;
    await db.generationRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', stage: 'DONE', finishedAt: new Date(), model: deps.gen.model, promptVersions: PROMPT_VERSIONS, cost: { calls: u.calls - before.calls, inputTokens: u.inputTokens - before.inputTokens, outputTokens: u.outputTokens - before.outputTokens, bulkModel: deps.gen.bulkModel } } });
    if (v.status === 'GENERATING') await db.guidelinesVersion.update({ where: { id: v.id }, data: { status: 'IN_REVIEW' } });
    await db.auditEvent.create({ data: { clientId: v.clientId, actorType: 'SYSTEM', actorId: 'cert-generator', entityType: 'GuidelinesVersion', entityId: v.id, action: 'cert.generation_completed', after: { runId: run.id, scope: run.scope, target } } });
  } catch (err) {
    await db.generationRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: (err instanceof Error ? err.message : String(err)).slice(0, 1000), finishedAt: new Date() } });
    await db.auditEvent.create({ data: { clientId: v.clientId, actorType: 'SYSTEM', actorId: 'cert-generator', entityType: 'GuidelinesVersion', entityId: v.id, action: 'cert.generation_failed', after: { runId: run.id, error: String(err).slice(0, 300) } } });
    if (v.status === 'GENERATING') await db.guidelinesVersion.update({ where: { id: v.id }, data: { status: 'IN_REVIEW' } });
  }
}

export function generationHandler(deps: Omit<ItemDeps, 'db'>): EventHandler {
  return {
    name: 'm10.guidelines-generate',
    event: 'guidelines.generate',
    async run(event, db) {
      await executeRun(db, { ...deps, db }, (event.payload as { runId: string }).runId);
    },
  };
}
