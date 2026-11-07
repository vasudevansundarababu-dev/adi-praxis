import { HarborBlueprint, type HarborBlueprintInput } from '@praxis/shared';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ObjectStorage } from '../src/candidate/storage';
import type { Config } from '../src/config';
import type { HarborRunner } from '../src/harbor/runner';
import { resolveDeps } from '../src/meta-compiler/deps';
import { MockContentDrafter } from '../src/meta-compiler/drafter';
import { metaCompilerHandlers } from '../src/meta-compiler/handlers';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { HandlerRegistry } from '../src/outbox/handlers';
import { createCandidate, db, idem } from './helpers';

/** Studio tasks use fixed coverage cells (no open slots): the studio has no coverage-tag control. */
export const COVERAGE = { dimensions: [{ key: 'channel', label: 'Channel', values: ['search', 'social', 'video'] }], cells: [] };

/** Synthetic, complete (6/6) blueprint shaped like the Harbor PDF §4.1 marketing template. No real data. */
export function exampleBlueprint(studioId = 'mktg-noise-cancelling-launch'): HarborBlueprint {
  const input: HarborBlueprintInput = {
    studio_id: studioId,
    catalog: {
      primary_work: 'Plan a 12-week launch budget for a synthetic noise-cancelling phone.',
      verification_criteria: 'Allocations respect the CAC ceiling and the oracle keyword table.',
      human_gate: 'A Reviewer checks the oracle table before approval.',
      skills: ['Performance marketing'],
      task_modes: ['AUTHORING'],
      coverage_dimensions: COVERAGE,
    },
    template_meta: { template_id: 'mktg-launch-ncp', label: 'Launch of Noise Cancelling Phone', domain_category: 'Digital Marketing', tpt_minutes: 45, tpt_label: '45m (12 Wks)', modes: ['HERMETIC_MCP'] },
    domain_meta: { title: 'Launch of Noise Cancelling Phone', persona_label: 'Growth Marketing Lead', horizon: { type: 'episodic_loop', max_turns: 12, cadence_unit: 'Wks' } },
    step_2_data_panels: {
      public_dropzones: [{ id: 'queries', label: 'Scraped queries', target_path: '/workspace/inputs/scraped_queries.csv', format: 'csv' }],
      oracle_annotator: {
        dataset_name: 'keyword_intent',
        target_path: '/eval/ground_truth/keyword_intent.csv',
        columns: ['keyword', 'intent'],
        sme_tag_options: ['BUY', 'RESEARCH', 'IGNORE'],
        template_preview_rows: [['quiet phone deal', 'BUY']],
      },
    },
    step_3_mcp_simulators: {
      tools: [{ tool_id: 'advance_campaign_week', parameters: [{ name: 'spend_usd', type: 'number' }] }],
      widgets: [{ archetype: 'diminishing_returns_curve_slider', key: 'k_half', label: 'Saturation (K_half)', min: 1000, max: 50000, default: 12000, step: 500 }],
    },
    step_4_invariant_catalog: { allowed_subjects: ['weekly_cac_usd'], rules: [{ id: 'cac_ceiling', subject: 'weekly_cac_usd', operator: 'GREATER_THAN', threshold: 42 }] },
    step_5_default_rubric: {
      milestones: [
        { id: 'intent_f1', label: 'Keyword intent', weight: 60, verifier_template: 'f1_set_match', verifier_body: 'assert env_state["f1"] >= 0.9' },
        { id: 'budget_lp', label: 'Budget allocation', weight: 40, verifier_template: 'lp_solver_ceiling', verifier_body: 'assert env_state["budget_ok"]' },
      ],
    },
    custom_fields_by_stage: {
      stage_3: [{ field_id: 'target_cac_ceiling', label: 'Target CAC ceiling', input_type: 'currency_slider', min: 10, max: 100, default_value: 42, inject_into: ['instruction.md', 'task.json', 'eval/test_verifiers.py'], verifier_assertion: "env_state['weekly_cac_usd'] <= 42" }],
    },
    authored_content: { instruction_md: 'Plan the launch budget week by week.', solve_sh: '#!/bin/sh\necho solved > /workspace/out.txt\n' },
  };
  return HarborBlueprint.parse(input);
}

export function jsonBody(bp: HarborBlueprint) {
  return JSON.parse(JSON.stringify(bp)) as Record<string, unknown>;
}

/** A template row written directly (the seed's job, Stream 1), optionally with a blueprint. */
export async function seedTemplate(clientId: string, o: { domainId?: string; domainName?: string; name?: string; status?: 'DRAFT' | 'PUBLISHED' | 'RETIRED'; blueprint?: HarborBlueprint | null; version?: number; lineageId?: string } = {}) {
  const domainId = o.domainId ?? (await db.domain.create({ data: { clientId, name: o.domainName ?? `Digital Marketing ${randomUUID().slice(0, 4)}` } })).id;
  const bp = o.blueprint === undefined ? exampleBlueprint(`studio-${randomUUID().slice(0, 8)}`) : o.blueprint;
  return db.template.create({
    data: {
      clientId,
      domainId,
      lineageId: o.lineageId ?? randomUUID(),
      version: o.version ?? 1,
      workflowName: o.name ?? 'Launch of Noise Cancelling Phone',
      status: o.status ?? 'DRAFT',
      publishedAt: o.status === 'PUBLISHED' ? new Date() : null,
      primaryWork: 'Plan a launch budget.',
      verificationCriteria: 'Oracle table.',
      humanGate: 'Reviewer.',
      defaultTptMinutes: 45,
      skills: ['Marketing'],
      taskModes: ['AUTHORING'],
      openSlotShare: 0,
      coverageDimensions: COVERAGE,
      ...(bp ? { blueprint: jsonBody(bp) as object, executionMode: 'HERMETIC_MCP' as const } : {}),
    },
    include: { domain: true },
  });
}

/** A staffed authoring project on the template, with one directly assigned SME (stub selection gate). */
export async function seedProject(clientId: string, ownerId: string, template: { id: string; version: number }, name = `PRJ-${randomUUID().slice(0, 6)}`) {
  const project = await db.project.create({
    data: { clientId, ownerId, templateId: template.id, templateVersion: template.version, name, status: 'STAFFED', taskMode: 'AUTHORING', distinctTarget: 6, maxPerExpert: 6, openSlotShare: 0, tptMinutes: 45 },
  });
  return project;
}

export async function assignSme(clientId: string, projectId: string, candidate?: { id: string }) {
  const c = candidate ?? (await createCandidate(clientId));
  await db.projectAssignment.create({ data: { clientId, projectId, candidateId: c.id } });
  return c;
}

export function api(app: FastifyInstance) {
  return {
    get: (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } }),
    post: (cookie: string, url: string, payload: object = {}, key = idem()) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...key }, payload }),
    put: (cookie: string, url: string, payload: object, key = idem()) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: { cookie, ...key }, payload }),
  };
}

/** Runs the Meta-Compiler worker jobs for every pending outbox event, as the worker would. */
export function workerFor(w: { config: Config; storage: ObjectStorage; runner: HarborRunner }) {
  return async () => {
    const registry = new HandlerRegistry();
    for (const h of metaCompilerHandlers({ ...w, drafters: () => new MockContentDrafter(), deps: resolveDeps() })) registry.register(h);
    for (const ev of await db.outboxEvent.findMany({ where: { name: { in: ['compiler.generation_requested', 'compiler.verification_requested', 'studio.task_committed'] } }, orderBy: { createdAt: 'asc' } })) {
      await processDomainEvent(db, registry, ev.id);
    }
  };
}

/** Generate and verify a template through the API (mock drafter and runner). */
export async function generateAndVerify(http: ReturnType<typeof api>, admin: string, work: () => Promise<void>, templateId: string) {
  const g = await http.post(admin, `/templates/${templateId}/generations`, { provider: 'mock', model: 'mock-drafter-1' });
  if (g.statusCode >= 300) throw new Error(`generation: ${g.statusCode} ${g.body}`);
  await work();
  const v = await http.post(admin, `/generations/${g.json().id}/verifications`);
  if (v.statusCode >= 300) throw new Error(`verification: ${v.statusCode} ${v.body}`);
  await work();
  return { generationId: g.json().id as string, verificationId: v.json().id as string };
}
