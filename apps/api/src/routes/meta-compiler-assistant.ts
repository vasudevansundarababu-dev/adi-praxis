import type { ElicitationPreset, Prisma } from '@prisma/client';
import { CUSTOM_FIELD_STAGES, CustomField, ElicitationPresetDto, ProposeFieldRequest, ProposeFieldResponse, SavePresetsRequest } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import { blueprintOf, fieldProblems } from '../meta-compiler/blueprint';
import { actualOverCap, budgetProblem, FIELD_PROPOSED, spentTodayUsd } from '../meta-compiler/cost';
import { costUsd, DrafterError, estimate, type DrafterFactory } from '../meta-compiler/drafter';
import { fieldProposalPrompt, parseFieldProposal } from '../meta-compiler/prompts';
import { IDEMPOTENCY_HEADER, runCommand } from '../platform/command';

const IdParams = z.object({ id: z.string().uuid() });
const ADMIN = ['ADMIN'] as const;
const PresetList = z.object({ items: z.array(ElicitationPresetDto) });
type ProposeFieldResponse = z.infer<typeof ProposeFieldResponse>;

export interface AssistantRouteOptions {
  db: Db;
  config: Config;
  drafters: DrafterFactory;
}

function presetDto(p: ElicitationPreset): ElicitationPresetDto {
  return { id: p.id, label: p.label, field: CustomField.parse(p.field), sortOrder: p.sortOrder, active: p.active };
}

const listPresets = async (tx: Db | Tx, domainId: string) => (await tx.elicitationPreset.findMany({ where: { domainId }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] })).map(presetDto);

/** Problems with a whole preset list: each field is validated like a manual field (S2-08); labels and field ids are unique. */
function presetListProblems(presets: z.infer<typeof SavePresetsRequest>['presets']): string[] {
  const out: string[] = [];
  const seen = { labels: new Set<string>(), fields: new Set<string>(), ids: new Set<string>() };
  for (const p of presets) {
    const label = p.label.toLowerCase();
    if (seen.labels.has(label)) out.push(`Preset "${p.label}" is listed more than once`);
    if (seen.fields.has(p.field.field_id)) out.push(`Custom field "${p.field.field_id}" is used by more than one preset`);
    if (p.id && seen.ids.has(p.id)) out.push(`Preset ${p.id} is listed more than once`);
    seen.labels.add(label);
    seen.fields.add(p.field.field_id);
    if (p.id) seen.ids.add(p.id);
    out.push(...fieldProblems(p.field).map((m) => `Preset "${p.label}": ${m}`));
  }
  return out;
}

/** D7 Guided Elicitation Assistant (S2-14): per-domain presets and AI field proposals. Admin only. */
export const metaCompilerAssistantRoutes: FastifyPluginAsyncZod<AssistantRouteOptions> = async (app, { db, config, drafters }) => {
  const mc = config.metaCompiler;

  app.get('/domains/:id/presets', { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], params: IdParams, response: { 200: PresetList } } }, async (req) => {
    const domain = await db.domain.findFirst({ where: { id: req.params.id, clientId: req.actor!.clientId } });
    if (!domain) throw notFound('Domain not found');
    return { items: await listPresets(db, domain.id) };
  });

  // Replaces the domain's whole list: listed presets are created or updated, presets left out are removed.
  app.put(
    '/domains/:id/presets',
    { config: { access: ADMIN }, schema: { tags: ['meta-compiler'], params: IdParams, body: SavePresetsRequest, response: { 200: PresetList } } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const domain = await tx.domain.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
        if (!domain) throw notFound('Domain not found');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`domain-presets:${domain.id}`}))`;
        const presets = req.body.presets;
        const problems = presetListProblems(presets);
        if (problems.length) throw new AppError(422, 'PRESETS_INVALID', 'Some presets need attention.', { problems });
        const before = await listPresets(tx, domain.id);
        const known = new Set(before.map((p) => p.id));
        const unknown = presets.filter((p) => p.id && !known.has(p.id));
        if (unknown.length) throw notFound(`Preset ${unknown[0]!.id} does not belong to this domain`);
        const keep = presets.flatMap((p) => (p.id ? [p.id] : []));
        await tx.elicitationPreset.deleteMany({ where: { domainId: domain.id, id: { notIn: keep } } });
        // Two passes so a label can move between presets without tripping the (domain, label) unique index.
        for (const p of presets) if (p.id) await tx.elicitationPreset.update({ where: { id: p.id }, data: { label: `~moving~${p.id}` } });
        for (const p of presets) {
          const data = { label: p.label, field: p.field as unknown as Prisma.InputJsonValue, sortOrder: p.sortOrder, active: p.active };
          if (p.id) await tx.elicitationPreset.update({ where: { id: p.id }, data });
          else await tx.elicitationPreset.create({ data: { ...data, clientId: actor.clientId, domainId: domain.id } });
        }
        const items = await listPresets(tx, domain.id);
        await audit({ entityType: 'Domain', entityId: domain.id, action: 'meta_compiler.presets_saved', before: { presets: before }, after: { presets: items } });
        return { status: 200, body: { items } };
      });
      return reply;
    },
  );

  /**
   * D7: a model proposes ONE custom field from the Admin's free text. The proposal is validated like a manual field and
   * returned, never saved; the Admin accepts it by saving the blueprint. The call, its cost and the proposal are audited
   * (the cost counts toward the daily budget). A repeat with the same Idempotency-Key replays without a second call.
   */
  app.post(
    '/templates/:id/assistant/propose-field',
    { config: { access: ADMIN, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['meta-compiler'], params: IdParams, body: ProposeFieldRequest, response: { 200: ProposeFieldResponse } } },
    async (req, reply) => {
      const actor = req.actor!;
      const key = req.headers[IDEMPOTENCY_HEADER];
      const stored = typeof key === 'string' ? await db.idempotencyKey.findUnique({ where: { actorId_key: { actorId: actor.userId, key } } }) : null;
      const replayed = stored !== null && stored.expiresAt > new Date();
      let body: ProposeFieldResponse | null = null;
      if (!replayed) {
        const t = await db.template.findFirst({ where: { id: req.params.id, clientId: actor.clientId }, include: { domain: true } });
        if (!t) throw notFound('Template not found');
        if (t.status !== 'DRAFT') throw new AppError(409, 'TEMPLATE_NOT_EDITABLE', `Only drafts can be edited (this version is ${t.status}). Create a new version to change it.`);
        const choice = req.body.model
          ? (mc.models.find((m) => m.model === req.body.model) ?? (!mc.liveAi && req.body.model.startsWith('mock') ? { provider: 'mock' as const, model: req.body.model } : null))
          : mc.liveAi
            ? mc.models[0]
            : { provider: 'mock' as const, model: 'mock-drafter-1' };
        if (!choice) throw new AppError(422, 'MODEL_NOT_AVAILABLE', `Model ${req.body.model} is not configured.`);
        const drafter = drafters(choice);
        const bp = blueprintOf(t);
        const existingIds = CUSTOM_FIELD_STAGES.flatMap((s) => bp.custom_fields_by_stage[s].map((f) => f.field_id));
        const prompt = fieldProposalPrompt(bp, req.body.stage, req.body.prompt);
        const base = { provider: drafter.provider, model: drafter.model };
        const unavailable = (reason: string, cost = 0): ProposeFieldResponse => ({ proposal: null, problems: [], ...base, costUsd: cost, unavailableReason: `${reason} You can still add the field by hand.` });
        const blocked = budgetProblem(mc, estimate(drafter, prompt).costUsd, await spentTodayUsd(db, actor.clientId));
        if (blocked) body = unavailable(blocked);
        else {
          try {
            const out = await drafter.complete(prompt);
            const cost = costUsd(drafter.provider, drafter.model, out.inputTokens, out.outputTokens);
            const capped = actualOverCap(mc, cost);
            body = capped ? unavailable(capped, cost) : { ...parseFieldProposal(out.text, existingIds, req.body.stage), ...base, costUsd: cost, unavailableReason: null };
          } catch (err) {
            body = unavailable(`The assistant could not draft a field (${err instanceof DrafterError ? err.message : 'model call failed'}).`);
          }
        }
      }
      await runCommand(db, req, reply, async ({ audit }) => {
        const b = body!;
        await audit({
          entityType: 'Template',
          entityId: req.params.id,
          action: FIELD_PROPOSED,
          after: { stage: req.body.stage, prompt: req.body.prompt, provider: b.provider, model: b.model, costUsd: b.costUsd, proposal: b.proposal, problems: b.problems, unavailableReason: b.unavailableReason },
        });
        return { status: 200, body: b };
      });
      return reply;
    },
  );
};
