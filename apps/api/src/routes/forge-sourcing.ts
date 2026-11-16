import '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { DirectAssignRequest, normEmail, RequiredWorkersRequest, SourcedPersonInput, SourcedRole, type SourcingImportResult, type SourcingImportRow } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Actor } from '../auth/actor';
import type { MalwareScanner, ObjectStorage } from '../candidate/storage';
import type { Db, Tx } from '../db';
import { buildAssessmentSheet, buildRecruiterPack, buildRecruiterPdf, COLUMN_KEYS, columnValue, isFixedColumn, packFileName, readAssessmentSheet, type SheetRow } from '../forge/recruiter-pack';
import { addSourcedPerson, adoptPoolPerson, assignable, changeAuthor, createSourcedPerson, directAssign, listSourcedPeople, projectPeople, raisePlacesToTaskCount, setRequiredWorkers, sourcedWithoutTask, sourcingProject, sourcingProjects, sourcingTarget, toSourcedPersonDto } from '../forge/sourcing';
import { resendSetLink, setLinkOnAssign, passwordMode, signInModeError } from '../forge/password';
import { forgeSettings } from '../forge/settings';
import type { Config } from '../config';
import type { EmailSender } from '../lib/email';
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

/**
 * New flow only: the project's task rows, one per coverage slot, created on first need (audited when any are made);
 * then Required workers is raised to the task count if it is lower (D19, audited).
 */
async function ensureTaskRows(tx: Tx, projectId: string, clientId: string, audit: (i: AuditInput) => Promise<void>) {
  if (!(await forgeSettings(tx, clientId)).newFlow) return 0;
  const made = await ensureSlotTasks(tx, projectId);
  if (made) await audit({ entityType: 'Project', entityId: projectId, action: 'project.task_rows_created', after: { tasks: made } });
  await raisePlacesToTaskCount(tx, projectId, audit);
  return made;
}


/** Checks one sheet row against the same rules as Sourcing → New. `seen` holds the emails of earlier rows. */
function checkRow(r: SheetRow, projectId: string, role: SourcedRole, seen: Map<string, number>, existing: Set<string>) {
  const v = r.values;
  const firstName = columnValue(v, COLUMN_KEYS.first);
  const lastName = columnValue(v, COLUMN_KEYS.last);
  const email = columnValue(v, COLUMN_KEYS.email);
  const linkedinUrl = columnValue(v, COLUMN_KEYS.linkedin);
  const agency = columnValue(v, COLUMN_KEYS.agency);
  const assessment: Record<string, string> = {};
  for (const [h, x] of Object.entries(v)) if (!isFixedColumn(h)) assessment[h.slice(0, 200)] = x;
  const problems: string[] = [];
  if (!firstName) problems.push('First name is required.');
  if (!lastName) problems.push('Last name is required.');
  if (!email) problems.push('Email is required.');
  if (Object.values(assessment).some((x) => x.length > 4000) || agency.length > 200) problems.push('A cell is too long (over 4000 characters).');
  const parsed = SourcedPersonInput.safeParse({ projectId, role, firstName, lastName, email, linkedinUrl: linkedinUrl || undefined, agency: agency || undefined, assessment });
  if (!parsed.success && !problems.length) {
    for (const i of parsed.error.issues) {
      const field = String(i.path[0]);
      const msg = field === 'email' ? 'Email is not a valid address.' : field === 'linkedinUrl' ? 'LinkedIn URL is not a valid web address.' : field === 'firstName' || field === 'lastName' ? 'A name is longer than 100 characters.' : `Check the ${field} column.`;
      if (!problems.includes(msg)) problems.push(msg);
    }
  }
  const key = normEmail(email);
  if (email && parsed.success) {
    if (existing.has(key)) problems.push('Already submitted to this project for this role.');
    else if (seen.has(key)) problems.push(`Repeated in this sheet (same email as row ${seen.get(key)}).`);
  }
  if (email && !seen.has(key)) seen.set(key, r.row);
  const row: SourcingImportRow = { row: r.row, firstName, lastName, email: email ? key : '', ok: problems.length === 0, problems };
  return { row, input: parsed.success && !problems.length ? parsed.data : null };
}

/** MVP1 Sourcing and direct task assignment (docs/design/PROJECT-SCREEN-DESIGN.md: Sourcing, Resource assignments, Tasks). */
export const forgeSourcingRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config; storage: ObjectStorage; scanner: MalwareScanner; email: EmailSender }> = async (app, { db, config, storage, scanner, email }) => {
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
    await withTaskRows(req.actor!, String(req.id), (await sourcingProject(db, req.actor!, req.params.id)).id);
    // Read after the task rows, so a raised Required workers shows at once.
    const p = await sourcingProject(db, req.actor!, req.params.id);
    return { reviewRoute: p.reviewRoute, requiredWorkers: p.requiredWorkers, items: await projectPeople(db, p.id), withoutTask: await sourcedWithoutTask(db, p.id) };
  });

  app.get('/projects/:id/assignable', { config: { access: ACCESS }, schema: { tags: ['sourcing'], params: IdParams } }, async (req) => {
    await withTaskRows(req.actor!, String(req.id), (await sourcingProject(db, req.actor!, req.params.id)).id);
    return assignable(db, await sourcingProject(db, req.actor!, req.params.id));
  });

  /** D19: the PM or Admin changes Required workers (SME places) from the Assign screen. Authorised, idempotent, audited. */
  app.post(
    '/projects/:id/required-workers',
    { config: { access: ACCESS }, schema: { tags: ['sourcing'], params: IdParams, body: RequiredWorkersRequest } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await sourcingProject(tx, actor, req.params.id);
        const r = await setRequiredWorkers(tx, p.id, req.body.requiredWorkers, audit);
        return { status: 200, body: { projectId: p.id, ...r } };
      });
      return reply;
    },
  );

  app.post('/projects/:id/assignments/direct', { config: { access: ACCESS }, schema: { tags: ['sourcing'], params: IdParams, body: DirectAssignRequest } }, async (req, reply) => {
    await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await sourcingProject(tx, actor, req.params.id);
      await tx.$executeRaw`SELECT 1 FROM "Project" WHERE id = ${p.id}::uuid FOR UPDATE`;
      const f = await forgeSettings(tx, p.clientId);
      if (!f.newFlow) throw new AppError(409, 'NEW_FLOW_OFF', 'Direct task assignment is not switched on for this platform.');
      if (p.status === 'DRAFT' || p.status === 'COMPLETED' || p.status === 'CANCELLED') throw new AppError(409, 'PROJECT_NOT_OPEN', 'People can be assigned only on new or active projects.');
      await ensureTaskRows(tx, p.id, p.clientId, audit);
      const fresh = await sourcingProject(tx, actor, p.id);
      // D20: someone from the platform pool gets their record on this project first.
      const sourcedPersonId = req.body.sourcedPersonId ?? (await adoptPoolPerson(tx, actor, fresh, { candidateId: req.body.candidateId!, role: req.body.role! }, audit)).id;
      const t = await directAssign(tx, fresh, { sourcedPersonId, taskId: req.body.taskId }, actor, audit);
      // Online sign-in: a new person gets a set-your-password link (after the database work, as invites do).
      await setLinkOnAssign(tx, { email, config }, f, sourcedPersonId, audit);
      return { status: 200, body: { taskId: t.id, status: t.status, revision: t.revision, sourcedPersonId, people: await projectPeople(tx, p.id) } };
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
        const f = await forgeSettings(tx, p.clientId);
        if (!f.newFlow) throw new AppError(409, 'NEW_FLOW_OFF', 'Direct task assignment is not switched on for this platform.');
        if (p.status === 'DRAFT' || p.status === 'COMPLETED' || p.status === 'CANCELLED') throw new AppError(409, 'PROJECT_NOT_OPEN', 'People can be assigned only on new or active projects.');
        const t = await changeAuthor(tx, p, { taskId: req.params.taskId, sourcedPersonId: req.body.sourcedPersonId }, actor, audit);
        await setLinkOnAssign(tx, { email, config }, f, req.body.sourcedPersonId, audit);
        return { status: 200, body: { taskId: t.id, status: t.status, revision: t.revision, people: await projectPeople(tx, p.id) } };
      });
      return reply;
    },
  );
  // ── MVP1 step 6: (re)send a set-your-password link to an assigned person (Online sign-in only) ──
  app.post(
    '/projects/:id/people/:sourcedPersonId/password-link',
    { config: { access: ACCESS, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['sourcing'], params: IdParams.extend({ sourcedPersonId: z.string().uuid() }) } },
    async (req, reply) => {
      await runCommand(db, req, reply, async ({ tx, actor, audit }) => {
        const p = await sourcingProject(tx, actor, req.params.id);
        if (!passwordMode(await forgeSettings(tx, p.clientId))) throw signInModeError(false);
        const s = await tx.sourcedPerson.findFirst({ where: { id: req.params.sourcedPersonId, projectId: p.id } });
        if (!s) throw new AppError(404, 'NOT_FOUND', 'Person not found on this project');
        const r = await resendSetLink(tx, { email, config }, s.id, audit);
        return { status: 200, body: { sent: true, expiresAt: r.expiresAt.toISOString() } };
      });
      return reply;
    },
  );

  // ── MVP1 step 5: Sourcing screens and Export to Recruiter ──

  app.get('/sourcing/projects', { config: { access: ACCESS }, schema: { tags: ['sourcing'] } }, async (req) => ({ items: await sourcingProjects(db, req.actor!) }));

  app.get('/projects/:id/recruiter-pack', { config: { access: ACCESS }, schema: { tags: ['sourcing'], params: IdParams } }, async (req) => buildRecruiterPack(db, req.actor!, req.params.id));

  app.get('/projects/:id/recruiter-pack.xlsx', { config: { access: ACCESS }, schema: { tags: ['sourcing'], params: IdParams } }, async (req, reply) => {
    const pack = await buildRecruiterPack(db, req.actor!, req.params.id);
    const sheet = await buildAssessmentSheet(pack);
    return reply
      .header('content-type', FILE_TYPES.xlsx)
      .header('content-disposition', `attachment; filename="${pack.fileName}"`)
      .header('cache-control', 'no-store')
      .send(sheet);
  });

  app.get('/projects/:id/recruiter-pack.pdf', { config: { access: ACCESS }, schema: { tags: ['sourcing'], params: IdParams } }, async (req, reply) => {
    const pack = await buildRecruiterPack(db, req.actor!, req.params.id);
    const pdf = await buildRecruiterPdf(pack, await buildAssessmentSheet(pack));
    return reply
      .header('content-type', FILE_TYPES.pdf)
      .header('content-disposition', `attachment; filename="${packFileName(pack.projectName)}"`)
      .header('cache-control', 'no-store')
      .send(pdf);
  });

  /** The recruiter's filled sheet: one profile per valid row. dryRun=1 only reports what would happen. */
  app.post(
    '/sourcing/people/import',
    { config: { access: ACCESS, rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['sourcing'], querystring: z.object({ dryRun: z.enum(['0', '1']).default('0') }) } },
    async (req, reply) => {
      const actor = req.actor!;
      const dryRun = req.query.dryRun === '1';
      const file = await req.file({ limits: { fileSize: MAX_BYTES + 1, files: 1, fields: 4 } });
      if (!file) throw badRequest('Attach the filled assessment sheet');
      const field = (k: string) => (file.fields[k] as { value?: string } | undefined)?.value;
      const meta = z.object({ projectId: z.string().uuid(), role: SourcedRole }).safeParse({ projectId: field('projectId'), role: field('role') });
      if (!meta.success) throw badRequest('Send projectId and role (SME or REVIEWER) before the file');
      const { projectId, role } = meta.data;
      // Visibility, open project and the Reviewer route: the same checks as Sourcing → New, before anything is read.
      await sourcingTarget(db, actor, projectId, role);
      const buf = await file.toBuffer();
      if (file.file.truncated || buf.length > MAX_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than 10 MB.');
      if (sniff(buf) !== 'xlsx') throw new AppError(415, 'UNSUPPORTED_FILE', 'Upload the assessment sheet as Excel (.xlsx).');
      const sheet = await readAssessmentSheet(buf);
      if ('error' in sheet) throw new AppError(422, 'BAD_SHEET', sheet.error);
      if (!sheet.rows.length) throw new AppError(422, 'BAD_SHEET', 'The sheet has no candidates: fill in one row per candidate under the header.');

      const check = async (tx: Db | Tx) => {
        const existing = new Set((await tx.sourcedPerson.findMany({ where: { projectId, role }, select: { emailNorm: true } })).map((x) => x.emailNorm));
        const seen = new Map<string, number>();
        return sheet.rows.map((r) => checkRow(r, projectId, role, seen, existing));
      };
      const result = (rows: SourcingImportRow[], created: number): SourcingImportResult => {
        const valid = rows.filter((r) => r.ok).length;
        return { projectId, role, dryRun, rows, valid, created, skipped: rows.length - created };
      };

      if (dryRun) {
        const checked = await check(db);
        return reply.status(200).send(result(checked.map((c) => c.row), 0));
      }
      if ((await scanner.scan(buf)) === 'INFECTED') throw new AppError(422, 'FILE_REJECTED', 'This file could not be accepted.');
      await runCommand(db, req, reply, async ({ tx, audit }) => {
        const p = await sourcingTarget(tx, actor, projectId, role);
        await tx.$executeRaw`SELECT 1 FROM "Project" WHERE id = ${p.id}::uuid FOR UPDATE`;
        const checked = await check(tx);
        const valid = checked.filter((c) => c.input);
        // The sheet is stored once; every profile made from it points at it.
        const key = valid.length ? `sourcing/${actor.clientId}/imports/${randomUUID()}.xlsx` : undefined;
        if (key) await storage.put(key, buf, FILE_TYPES.xlsx);
        for (const c of valid) await createSourcedPerson(tx, actor, p, c.input!, audit, { assessmentStorageKey: key });
        // Counts only: names and emails stay out of the audit log.
        await audit({ entityType: 'Project', entityId: p.id, action: 'sourcing.people_imported', after: { projectId: p.id, role, created: valid.length, skipped: checked.length - valid.length, sha256: sha256(buf.toString('binary')) } });
        return { status: 200, body: result(checked.map((c) => c.row), valid.length) };
      });
      return reply;
    },
  );
};
