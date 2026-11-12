import type { ApprovedTaskRecord } from '@prisma/client';
import { exportEligibility, TaskValidationResult, ValidateRequest, ValidationRunDto } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ObjectStorage } from '../candidate/storage';
import type { Db, Tx } from '../db';
import { sha256 } from '../lib/crypto';
import { AppError, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { validationItem, type AnvilTaskValidator } from '../anvil/validator';
import { toRecordDto } from './dataset';
import { loadProject } from './projects';

const Params = z.object({ id: z.string().uuid() });
const ACCESS = ['ADMIN', 'PM'] as const;
const today = () => new Date().toISOString().slice(0, 10);
const titleOf = (r: ApprovedTaskRecord) => String((r.output as { header?: { title?: unknown } } | null)?.header?.title ?? '') || `Task ${r.taskInstanceId.slice(0, 8)}`;

/** The project's approved tasks as they stand: a corrected record is replaced by its correction. */
async function currentRecords(tx: Db | Tx, clientId: string, projectId: string) {
  const rows = await tx.approvedTaskRecord.findMany({ where: { clientId, projectId }, orderBy: { seq: 'asc' } });
  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
  return rows.filter((r) => !superseded.has(r.id));
}

async function eligibility(tx: Db | Tx, clientId: string, p: { id: string; status: string; distinctTarget: number | null; endDate: Date | null }) {
  const records = await currentRecords(tx, clientId, p.id);
  return { records, ...exportEligibility({ status: p.status, approvedTasks: records.length, distinctTarget: p.distinctTarget, endDate: p.endDate?.toISOString().slice(0, 10) ?? null, today: today() }) };
}

const counts = (results: TaskValidationResult[]) => ({ valid: results.filter((r) => r.status === 'valid').length, needsFix: results.filter((r) => r.status === 'needs_fix').length, notValidated: results.filter((r) => r.status === 'not_validated').length });

function runDto(r: { id: string; projectId: string; kind: string; validator: string; validatorVersion: string; results: unknown; requestedById: string; createdAt: Date; fileKey: string | null }): ValidationRunDto {
  const results = z.array(TaskValidationResult).parse(r.results);
  return { id: r.id, projectId: r.projectId, kind: r.kind as 'VALIDATE' | 'EXPORT', validator: r.validator, validatorVersion: r.validatorVersion, results, counts: counts(results), requestedById: r.requestedById, createdAt: r.createdAt.toISOString(), downloadPath: r.fileKey ? `/projects/${r.projectId}/exports/${r.id}/download` : null };
}

/** Validates the records; a validator failure marks them not validated instead of guessing. */
async function validate(tx: Db | Tx, validator: AnvilTaskValidator, records: ApprovedTaskRecord[]) {
  const tasks = await tx.taskInstance.findMany({ where: { id: { in: records.map((r) => r.taskInstanceId) } }, select: { id: true, checks: true } });
  const blockers = new Map(tasks.map((t) => [t.id, ((t.checks as { export?: { blockers?: { code: string; path: string; message: string }[] } } | null)?.export?.blockers ?? [])]));
  const items = records.map((r) => validationItem(r, titleOf(r), blockers.get(r.taskInstanceId) ?? []));
  try {
    return { items, results: await validator.validate(items) };
  } catch (e) {
    const message = `The validator did not answer: ${e instanceof Error ? e.message : String(e)}`;
    return { items, results: items.map((i) => ({ recordId: i.record.id, taskId: i.taskId, title: i.title, status: 'not_validated' as const, issues: [{ code: 'VALIDATOR_UNAVAILABLE', path: null, message }] })) };
  }
}

/**
 * Project export with Anvil validation (owner, 12 Nov 2026). The owning PM or an Admin validates one approved task at
 * any time, and exports every approved task once the project is complete (required tasks approved, marked complete or
 * its end date reached). Each run is kept append-only with the validator's verdict per task.
 */
export const projectExportRoutes: FastifyPluginAsyncZod<{ db: Db; storage: ObjectStorage; validator: AnvilTaskValidator }> = async (app, { db, storage, validator }) => {
  app.get('/projects/:id/export', { config: { access: ACCESS }, schema: { tags: ['projects'], params: Params } }, async (req) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    const e = await eligibility(db, req.actor!.clientId, p);
    const runs = await db.projectValidationRun.findMany({ where: { projectId: p.id, clientId: req.actor!.clientId }, orderBy: { createdAt: 'desc' }, take: 10 });
    return {
      canValidate: e.canValidate,
      canExport: e.canExport,
      reason: e.reason,
      validator: { name: validator.name, version: validator.version, isAnvil: validator.name === 'anvil' },
      tasks: e.records.map((r) => ({ recordId: r.id, taskId: r.taskInstanceId, title: titleOf(r), approvedAt: r.reviewDecisionAt.toISOString() })),
      runs: runs.map(runDto),
    };
  });

  app.post('/projects/:id/validate', { config: { access: ACCESS }, schema: { tags: ['projects'], params: Params, body: ValidateRequest, response: { 201: ValidationRunDto } } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await loadProject(tx, req.params.id, actor);
      const e = await eligibility(tx, actor.clientId, p);
      if (!e.canValidate) throw new AppError(409, 'NOT_VALIDATABLE', e.reason ?? 'Nothing to validate.');
      const records = e.records.filter((r) => req.body.recordIds.includes(r.id));
      if (records.length !== req.body.recordIds.length) throw notFound('Approved task not found in this project');
      const { results } = await validate(tx, validator, records);
      const run = await tx.projectValidationRun.create({ data: { clientId: actor.clientId, projectId: p.id, kind: 'VALIDATE', validator: validator.name, validatorVersion: validator.version, recordIds: records.map((r) => r.id), results, requestedById: actor.userId } });
      await audit({ entityType: 'Project', entityId: p.id, action: 'project.validated', after: { runId: run.id, validator: validator.name, ...counts(results) } });
      return { status: 201, body: runDto(run) };
    });
    return reply;
  });

  app.post('/projects/:id/exports', { config: { access: ACCESS }, schema: { tags: ['projects'], params: Params, body: z.object({}).strict(), response: { 201: ValidationRunDto } } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await loadProject(tx, req.params.id, actor);
      const e = await eligibility(tx, actor.clientId, p);
      if (!e.canExport) throw new AppError(409, 'NOT_EXPORTABLE', e.reason ?? 'The project cannot be exported yet.');
      const { items, results } = await validate(tx, validator, e.records);
      const byRecord = new Map(results.map((r) => [r.recordId, r]));
      // One line per approved task: the dataset record, its Anvil export envelope (when it has one) and the verdict.
      const file = items.map((i) => JSON.stringify({ record: toRecordDto(i.record), anvilExport: i.envelope, validation: byRecord.get(i.record.id) ?? null })).join('\n') + '\n';
      const id = crypto.randomUUID();
      const key = `exports/${actor.clientId}/${p.id}/${id}.ndjson`;
      await storage.put(key, Buffer.from(file, 'utf8'), 'application/x-ndjson');
      const run = await tx.projectValidationRun.create({ data: { id, clientId: actor.clientId, projectId: p.id, kind: 'EXPORT', validator: validator.name, validatorVersion: validator.version, recordIds: items.map((i) => i.record.id), results, fileKey: key, fileSha256: sha256(file), requestedById: actor.userId } });
      await audit({ entityType: 'Project', entityId: p.id, action: 'project.exported', after: { runId: run.id, tasks: items.length, validator: validator.name, fileSha256: run.fileSha256, ...counts(results) } });
      return { status: 201, body: runDto(run) };
    });
    return reply;
  });

  app.get('/projects/:id/exports/:runId/download', { config: { access: ACCESS }, schema: { tags: ['projects'], params: Params.extend({ runId: z.string().uuid() }) } }, async (req, reply) => {
    const p = await loadProject(db, req.params.id, req.actor!);
    const run = await db.projectValidationRun.findFirst({ where: { id: req.params.runId, projectId: p.id, clientId: req.actor!.clientId, kind: 'EXPORT' } });
    if (!run?.fileKey) throw notFound('Export not found');
    const body = await storage.get(run.fileKey);
    if (sha256(body.toString('utf8')) !== run.fileSha256) throw new AppError(409, 'EXPORT_INTEGRITY', 'The stored export does not match its recorded hash.');
    return reply.header('content-type', 'application/x-ndjson').header('content-disposition', `attachment; filename="praxis-project-${p.id}-export-${run.id}.ndjson"`).header('x-praxis-export-sha256', run.fileSha256!).send(body);
  });
};
