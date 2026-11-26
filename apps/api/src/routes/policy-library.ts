import { createHash } from 'node:crypto';
import { jurisdictionProblem } from '@praxis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { jcs, jcsSha256 } from '../anvil/jcs';
import type { Db } from '../db';
import { AppError, notFound } from '../lib/errors';
import { runCommand } from '../platform/command';
import { POLICY_ACCESS, policyProject } from '../policy/access';
import { buildPolicyLibrary, isoJurisdiction } from '../policy/library-export';
import { loadVersionText } from '../policy/documents';
import type { ObjectStorage } from '../candidate/storage';

/**
 * KYC Judgment v1 A4 (owner, 25 Nov 2026; contract C1 policy-library.v1): a policy document's library details (kind,
 * ISO jurisdiction, and where and when an official text was downloaded), and the policy library export. An export is
 * kept with its exact bytes; the same library returns the stored export, a changed one is the next revision.
 */
const ProjectParams = z.object({ projectId: z.string().uuid() });
const DocumentLibrary = z
  .object({
    kind: z.enum(['official_text', 'bank_policy']),
    jurisdiction: z.string().trim().min(1).max(100).optional(),
    captureSourceUrl: z.string().trim().url().regex(/^https?:\/\//).max(2000).optional(),
    captureDownloadedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** D-090: the date the document is in force from; rules without their own date take it. null clears it; absent keeps it. */
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .strict();

/** A calendar date that exists (2026-02-30 does not), as a UTC midnight. */
function calendarDay(s: string): Date | null {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

export const policyLibraryRoutes: FastifyPluginAsyncZod<{ db: Db; storage: ObjectStorage }> = async (app, { db, storage }) => {
  const loadText = (v: { textStorageKey: string }) => loadVersionText(storage, v);
  app.put('/projects/:projectId/policy/documents/:documentId/library', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ documentId: z.string().uuid() }), body: DocumentLibrary } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      const doc = await tx.policyDocument.findFirst({ where: { id: req.params.documentId, projectId: p.id, clientId: actor.clientId } });
      if (!doc) throw notFound('Document not found');
      const b = req.body;
      if (b.kind === 'official_text' && (!b.captureSourceUrl || !b.captureDownloadedOn)) throw new AppError(422, 'CAPTURE_REQUIRED', 'An official text needs where it was downloaded from (http or https) and the date it was downloaded.');
      const jurisdiction = b.jurisdiction === undefined ? doc.jurisdiction : isoJurisdiction(b.jurisdiction);
      if (b.jurisdiction !== undefined && !jurisdiction) throw new AppError(422, 'JURISDICTION_NOT_ISO', `${jurisdictionProblem(b.jurisdiction.trim().toUpperCase()) ?? `"${b.jurisdiction}" is not a jurisdiction the library can use.`} Use an ISO code such as US or US-CA.`);
      const captureDay = b.kind === 'official_text' ? calendarDay(b.captureDownloadedOn!) : null;
      if (b.kind === 'official_text' && !captureDay) throw new AppError(422, 'DATE_INVALID', `${b.captureDownloadedOn} is not a calendar date.`);
      const effectiveDay = b.effectiveFrom ? calendarDay(b.effectiveFrom) : null;
      if (b.effectiveFrom && !effectiveDay) throw new AppError(422, 'DATE_INVALID', `${b.effectiveFrom} is not a calendar date.`);
      const effectiveFrom = b.effectiveFrom === undefined ? doc.effectiveFrom : effectiveDay;
      const data = { libraryKind: b.kind, jurisdiction, captureSourceUrl: b.kind === 'official_text' ? b.captureSourceUrl! : null, captureDownloadedOn: captureDay, effectiveFrom };
      await tx.policyDocument.update({ where: { id: doc.id }, data });
      const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
      await audit({ entityType: 'PolicyDocument', entityId: doc.id, action: 'policy.document_library_set', before: { kind: doc.libraryKind, jurisdiction: doc.jurisdiction, captureSourceUrl: doc.captureSourceUrl, effectiveFrom: day(doc.effectiveFrom) }, after: { kind: data.libraryKind, jurisdiction: data.jurisdiction, captureSourceUrl: data.captureSourceUrl, captureDownloadedOn: b.captureDownloadedOn ?? null, effectiveFrom: day(effectiveFrom) } });
      return { status: 200, body: { kind: data.libraryKind, jurisdiction: data.jurisdiction, captureSourceUrl: data.captureSourceUrl, captureDownloadedOn: day(captureDay), effectiveFrom: day(effectiveFrom) } };
    });
    return reply;
  });

  app.post('/projects/:projectId/policy/library-exports', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams, body: z.object({}).strict() } }, async (req, reply) => {
    await runCommand<unknown>(db, req, reply, async ({ tx, actor, audit }) => {
      const p = await policyProject(tx, actor, req.params.projectId);
      // One export at a time per project, so two requests can't take the same revision.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'policy-library:' + p.id}))`;
      const built = await buildPolicyLibrary(tx, actor.clientId, p.id, { loadText });
      if (built.problems.length) throw new AppError(422, 'LIBRARY_NOT_EXPORTABLE', `The policy library can't be exported yet: ${built.problems.length} problem${built.problems.length === 1 ? '' : 's'}. ${built.problems.slice(0, 5).join(' ')}`, { problems: built.problems });
      const contentSha256 = jcsSha256(built.content);
      const latest = await tx.policyLibraryExport.findFirst({ where: { projectId: p.id }, orderBy: { revision: 'desc' } });
      if (latest && latest.contentSha256 === contentSha256) {
        await audit({ entityType: 'PolicyLibraryExport', entityId: latest.id, action: 'policy.library_export_unchanged', after: { revision: latest.revision } });
        return { status: 200, body: { revision: latest.revision, exportId: latest.exportId, sha256: latest.bytesSha256, unchanged: true, rules: latest.rules, versions: latest.versions, library: JSON.parse(latest.bytes) as unknown } };
      }
      const revision = (latest?.revision ?? 0) + 1;
      const exportId = `plx-${contentSha256.slice(0, 16)}-r${revision}`;
      const library = { ...built.content, export: { export_id: exportId, project_id: p.id, library_revision: revision, exported_at: new Date().toISOString(), exported_by: actor.userId } };
      const bytes = jcs(library);
      const sha256 = createHash('sha256').update(Buffer.from(bytes, 'utf8')).digest('hex');
      const row = await tx.policyLibraryExport.create({ data: { clientId: actor.clientId, projectId: p.id, revision, exportId, contentSha256, bytes, bytesSha256: sha256, rules: built.counts.rules, versions: built.counts.versions, createdById: actor.userId } });
      await audit({ entityType: 'PolicyLibraryExport', entityId: row.id, action: 'policy.library_exported', after: { revision, exportId, sha256, rules: built.counts.rules, versions: built.counts.versions } });
      return { status: 201, body: { revision, exportId, sha256, unchanged: false, rules: built.counts.rules, versions: built.counts.versions, library: JSON.parse(bytes) as unknown } };
    });
    return reply;
  });

  app.get('/projects/:projectId/policy/library-exports', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams } }, async (req) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const rows = await db.policyLibraryExport.findMany({ where: { projectId: p.id }, orderBy: { revision: 'desc' }, select: { revision: true, exportId: true, bytesSha256: true, rules: true, versions: true, createdById: true, createdAt: true } });
    return { items: rows.map((r) => ({ revision: r.revision, exportId: r.exportId, sha256: r.bytesSha256, rules: r.rules, versions: r.versions, exportedBy: r.createdById, at: r.createdAt.toISOString() })) };
  });

  /** The export's exact bytes (what Studio checks in), with their SHA-256 in a header. */
  app.get('/projects/:projectId/policy/library-exports/:revision', { config: { access: POLICY_ACCESS }, schema: { tags: ['policy'], params: ProjectParams.extend({ revision: z.coerce.number().int().min(1) }) } }, async (req, reply) => {
    const p = await policyProject(db, req.actor!, req.params.projectId);
    const row = await db.policyLibraryExport.findFirst({ where: { projectId: p.id, revision: req.params.revision } });
    if (!row) throw notFound('Export not found');
    return reply
      .header('content-type', 'application/json')
      .header('content-disposition', `attachment; filename="policy-library-${p.id}-r${row.revision}.json"`)
      .header('x-policy-library-sha256', row.bytesSha256)
      .send(row.bytes);
  });
};
