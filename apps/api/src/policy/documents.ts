import { createHash, randomUUID } from 'node:crypto';
import type { MalwareScanner, ObjectStorage } from '../candidate/storage';
import type { Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import type { AuditInput } from '../platform/audit';
import { readPolicyDocument, type ReadPolicyDocument } from './document-reader';

export interface DocumentMeta {
  title: string;
  category?: string | null;
  language?: string | null;
  jurisdiction?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

const safeName = (n: string) => n.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'document';

/**
 * Adds an immutable document version (S1 E01–E04). A new document is created unless documentId is given; a new version
 * of an existing document never rewrites earlier versions. The original bytes and Praxis's text reading are stored
 * privately under keys that never contain user input.
 */
export async function addDocumentVersion(
  tx: Tx,
  deps: { storage: ObjectStorage; scanner: MalwareScanner; maxPages: number },
  input: { clientId: string; projectId: string; actorId: string; documentId?: string | null; meta: DocumentMeta; fileName: string; buf: Buffer; origin: 'UPLOAD' | 'MANUAL_TEXT' | 'SEED' | 'SME_PROPOSAL'; read?: ReadPolicyDocument },
  audit: (a: AuditInput) => Promise<void>,
) {
  const read = input.read ?? (await readPolicyDocument(input.buf, input.fileName, deps.maxPages));
  if ((await deps.scanner.scan(input.buf)) !== 'CLEAN') throw new AppError(422, 'FILE_REJECTED', 'The file did not pass the malware scan.');
  const sha256 = createHash('sha256').update(input.buf).digest('hex');

  let doc;
  if (input.documentId) {
    doc = await tx.policyDocument.findFirst({ where: { id: input.documentId, projectId: input.projectId, clientId: input.clientId, archivedAt: null } });
    if (!doc) throw notFound('Policy document not found');
    const same = await tx.policyDocumentVersion.findFirst({ where: { documentId: doc.id, sha256 } });
    if (same) return { document: doc, version: same, created: false };
  } else {
    doc = await tx.policyDocument.create({
      data: {
        clientId: input.clientId,
        projectId: input.projectId,
        title: input.meta.title,
        category: input.meta.category ?? null,
        language: input.meta.language ?? null,
        jurisdiction: input.meta.jurisdiction ?? null,
        effectiveFrom: input.meta.effectiveFrom ? new Date(input.meta.effectiveFrom) : null,
        effectiveTo: input.meta.effectiveTo ? new Date(input.meta.effectiveTo) : null,
        createdById: input.actorId,
      },
    });
  }
  const next = await tx.policyDocument.update({ where: { id: doc.id }, data: { latestVersion: { increment: 1 } } });
  const id = randomUUID();
  const storageKey = `policy/${input.clientId}/${input.projectId}/${id}/original`;
  const textStorageKey = `policy/${input.clientId}/${input.projectId}/${id}/text.json`;
  await deps.storage.put(storageKey, input.buf, read.mediaType);
  await deps.storage.put(textStorageKey, Buffer.from(JSON.stringify({ text: read.text, pages: read.pages })), 'application/json');
  const version = await tx.policyDocumentVersion.create({
    data: {
      id,
      clientId: input.clientId,
      projectId: input.projectId,
      documentId: doc.id,
      version: next.latestVersion,
      sha256,
      fileName: safeName(input.fileName),
      mediaType: read.mediaType,
      format: read.format,
      sizeBytes: input.buf.length,
      pageCount: read.pageCount,
      pageCountMethod: read.pageCountMethod,
      storageKey,
      textStorageKey,
      textChars: read.text.length,
      locatorGranularity: read.locatorGranularity,
      origin: input.origin,
      uploadedById: input.actorId,
    },
  });
  await audit({ entityType: 'PolicyDocumentVersion', entityId: version.id, action: 'policy.document_version_added', after: { documentId: doc.id, version: version.version, sha256, format: read.format, pageCount: read.pageCount, origin: input.origin } });
  return { document: next, version, created: true };
}

export async function loadVersionText(storage: ObjectStorage, v: { textStorageKey: string }): Promise<{ text: string; pages: string[] }> {
  return JSON.parse((await storage.get(v.textStorageKey)).toString('utf8')) as { text: string; pages: string[] };
}
