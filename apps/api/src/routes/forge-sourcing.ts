import '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { DirectAssignRequest, SourcedPersonInput, SourcedRole } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Actor } from '../auth/actor';
import type { MalwareScanner, ObjectStorage } from '../candidate/storage';
import type { Db, Tx } from '../db';
import { addSourcedPerson, assignable, changeAuthor, directAssign, listSourcedPeople, projectPeople, sourcingProject, toSourcedPersonDto } from '../forge/sourcing';
import { forgeSettings } from '../forge/settings';
import { sha256 } from '../lib/crypto';
import { AppError, badRequest } from '../lib/errors';
import { writeAudit, type AuditInput } from '../platform/audit';
import { runCommand } from '../platform/command';
import { ensureSlotTasks } from '../tasks/task-service';

const ACCESS = ['ADMIN', 'PM'] as const;
const IdParams = z.object({ id: z.string().uuid() });
const MAX_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;

/** Files are identified by signature, not by name or declared type. */
function sniff(buf: Buffer): keyof typeof FILE_TYPES | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from('xl/'))) return 'xlsx';
  return null;
}

/** New flow only: the project's task rows, one per coverage slot, created on first need (audited when any are made). */
async function ensureTaskRows(tx: Tx, projectId: string, clientId: string, audit: (i: AuditInput) => Promise<void>) {
  if (!(await forgeSettings(tx, clientId)).newFlow) return 0;
  const made = await ensureSlotTasks(tx, projectId);
  if (made) await audit({ entityType: 'Project', entityId: projectId, action: 'project.task_rows_created', after: { tasks: made } });
  return made;
}

/** MVP1 Sourcing and direct task assignment (docs/design/PROJECT-SCREEN-DESIGN.md: Sourcing, Resource assignments, Tasks). */
export const forgeSourcingRoutes: FastifyPluginAsyncZod<{ db: Db; storage: ObjectStorage; scanner: MalwareScanner }> = async (app, { db, storage, scanner }) => {
  /** A read that may lazily create task rows: one short transaction, audited as the caller. */
  const withTaskRows = (actor: Actor, requestId: string, projectId: string) =>
    db.$transaction((tx) => ensureTaskRows(tx, projectId, actor.clientId, (input) => writeAudit(tx, { clientId: actor.clientId, actorType: 'USER', actorId: actor.userId, requestId }, input)));

  app.post('/sourcing/people', { config: { access: ACCESS }, schema: { tags: ['sourcing'], body: SourcedPersonInput } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const { person, project } = await addSourcedPerson(tx, actor, req.body, audit);
      const u = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
      return { status: 201, body: toSourcedPersonDto(person, project, u.name || u.email) };
    });
    return reply;
  });

  app.post('/sourcing/people/:id/files', { config: { access: ACCESS, rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags: ['sourcing'], params: IdParams } }, async (req, reply) => {
    const actor = req.actor!;
    // The person must be visible to the caller before anything is stored.
    const pre = await db.sourcedPerson.findFirst({ where: { id: req.params.id, clientId: actor.clientId } });
    if (!pre) throw new AppError(404, 'NOT_FOUND', 'Person not found');
    await sourcingProject(db, actor, pre.projectId);
    const file = await req.file({ limits: { fileSize: MAX_BYTES + 1, files: 1, fields: 3 } });
    if (!file) throw badRequest('Attach a file');
    const kind = (file.fields.kind as { value?: string } | undefined)?.value;
    if (kind !== 'cv' && kind !== 'assessment') throw badRequest('Say which file this is: kind must be cv or assessment (sent before the file)');
    const buf = await file.toBuffer();
    if (file.file.truncated || buf.length > MAX_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
    const type = sniff(buf);
    if (kind === 'cv' && type !== 'pdf') throw new AppError(415, 'UNSUPPORTED_FILE', 'Upload the profile as a PDF.');
    if (kind === 'assessment' && !type) throw new AppError(415, 'UNSUPPORTED_FILE', 'Upload the answers file as Excel (.xlsx) or PDF.');
    if ((await scanner.scan(buf)) === 'INFECTED') throw new AppError(422, 'FILE_REJECTED', 'This file could not be accepted.');
    const key = `sourcing/${actor.clientId}/${pre.id}/${kind}-${randomUUID()}.${type}`;
    await storage.put(key, buf, FILE_TYPES[type!]);
    await runCommand(db, req, reply, async ({ tx, audit }) => {
      const s = await tx.sourcedPerson.update({ where: { id: pre.id }, data: kind === 'cv' ? { cvStorageKey: key } : { assessmentStorageKey: key } });
      await audit({ entityType: 'SourcedPerson', entityId: s.id, action: 'sourcing.file_uploaded', after: { kind, mimeType: FILE_TYPES[type!], sizeBytes: buf.length, sha256: sha256(buf.toString('binary')) } });
      return { status: 200, body: { id: s.id, kind, mimeType: FILE_TYPES[type!], sizeBytes: buf.length, hasCv: s.cvStorageKey !== null, hasAssessment: s.assessmentStorageKey !== null } };
    });
    return reply;
  });

  app.get(
    '/sourcing/people',
    { config: { access: ACCESS }, schema: { tags: ['sourcing'], querystring: z.object({ role: SourcedRole.optional(), q: z.string().max(200).optional() }) } },
    async (req) => ({ items: await listSourcedPeople(db, req.actor!, req.query) }),
  );

  app.get('/projects/:id/people', { config: { access: ACCESS }, schema: { tags: ['sourcing'], params: IdParams } }, async (req) => {
    const p = await sourcingProject(db, req.actor!, req.params.id);
    await withTaskRows(req.actor!, String(req.id), p.id);
    return { reviewRoute: p.reviewRoute, requiredWorkers: p.requiredWorkers, items: await projectPeople(db, p.id) };
  });

  app.get('/projects/:id/assignable', { config: { access: ACCESS }, schema: { tags: ['sourcing'], params: IdParams } }, async (req) => {
    const p = await sourcingProject(db, req.actor!, req.params.id);
    await withTaskRows(req.actor!, String(req.id), p.id);
    return assignable(db, p);
  });

  app.post('/projects/:id/assignments/direct', { config: { access: ACCESS }, schema: { tags: ['sourcing'], params: IdParams, body: DirectAssignRequest } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await sourcingProject(tx, actor, req.params.id);
      await tx.$executeRaw`SELECT 1 FROM "Project" WHERE id = ${p.id}::uuid FOR UPDATE`;
      if (!(await forgeSettings(tx, p.clientId)).newFlow) throw new AppError(409, 'NEW_FLOW_OFF', 'Direct task assignment is not switched on for this platform.');
      if (p.status === 'DRAFT' || p.status === 'COMPLETED' || p.status === 'CANCELLED') throw new AppError(409, 'PROJECT_NOT_OPEN', 'People can be assigned only on new or active projects.');
      await ensureTaskRows(tx, p.id, p.clientId, audit);
      const t = await directAssign(tx, p, req.body, actor, audit);
      return { status: 200, body: { taskId: t.id, status: t.status, revision: t.revision, people: await projectPeople(tx, p.id) } };
    });
    return reply;
  });

  app.post(
    '/projects/:id/tasks/:taskId/author',
    { config: { access: ACCESS }, schema: { tags: ['sourcing'], params: IdParams.extend({ taskId: z.string().uuid() }), body: z.object({ sourcedPersonId: z.string().uuid() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await sourcingProject(tx, actor, req.params.id);
        await tx.$executeRaw`SELECT 1 FROM "Project" WHERE id = ${p.id}::uuid FOR UPDATE`;
        if (!(await forgeSettings(tx, p.clientId)).newFlow) throw new AppError(409, 'NEW_FLOW_OFF', 'Direct task assignment is not switched on for this platform.');
        if (p.status === 'DRAFT' || p.status === 'COMPLETED' || p.status === 'CANCELLED') throw new AppError(409, 'PROJECT_NOT_OPEN', 'People can be assigned only on new or active projects.');
        const t = await changeAuthor(tx, p, { taskId: req.params.taskId, sourcedPersonId: req.body.sourcedPersonId }, actor, audit);
        return { status: 200, body: { taskId: t.id, status: t.status, revision: t.revision, people: await projectPeople(tx, p.id) } };
      });
      return reply;
    },
  );
};
