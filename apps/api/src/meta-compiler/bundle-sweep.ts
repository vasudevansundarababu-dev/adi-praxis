import { Storage } from '@google-cloud/storage';
import type { Config } from '../config';
import type { Db } from '../db';
import { writeAudit } from '../platform/audit';

export const BUNDLE_SWEEP_JOB = 'bundle-sweep';
const MAX_AGE_MS = 24 * 3600_000;

export interface StoredObject {
  key: string;
  updatedAt: Date;
}

/** The listing and deletion the sweep needs; the app's ObjectStorage has no listing. */
export interface BundleObjectStore {
  list(prefix: string): AsyncIterable<StoredObject>;
  delete(key: string): Promise<void>;
}

export class GcsBundleObjectStore implements BundleObjectStore {
  private readonly bucket;
  constructor(bucketName: string, opts: { apiEndpoint?: string; projectId?: string } = {}) {
    this.bucket = new Storage(opts).bucket(bucketName);
  }
  async *list(prefix: string): AsyncIterable<StoredObject> {
    let pageToken: string | undefined;
    do {
      const [files, next] = await this.bucket.getFiles({ prefix, autoPaginate: false, maxResults: 1000, pageToken });
      for (const f of files) yield { key: f.name, updatedAt: new Date(String(f.metadata.updated ?? f.metadata.timeCreated)) };
      pageToken = (next as { pageToken?: string } | null)?.pageToken;
    } while (pageToken);
  }
  async delete(key: string) {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
}

export function defaultBundleObjectStore(config: Config): BundleObjectStore {
  return new GcsBundleObjectStore(config.EVIDENCE_BUCKET, config.GCS_EMULATOR_HOST ? { apiEndpoint: config.GCS_EMULATOR_HOST, projectId: config.GCS_PROJECT_ID } : {});
}

const COMMITTED = /^bundles\/([0-9a-f-]{36})\/([0-9a-f]{64})\.tar\.gz$/;
const VERIFY = /^bundles\/verify\/([0-9a-f-]{36})\/([0-9a-f]{64})\.tar\.gz$/;

/** Whether a bundle object is still used: by an authored task, a template verification, or a task's verification copy. */
async function referenced(db: Db, key: string): Promise<boolean | null> {
  const committed = key.match(COMMITTED);
  if (committed) return (await db.smeAuthoredTask.count({ where: { bundleRef: key } })) > 0;
  const verify = key.match(VERIFY);
  if (verify) {
    const [, clientId, sha] = verify;
    const [runs, tasks] = await Promise.all([db.compilerVerificationRun.count({ where: { bundleRef: key } }), db.smeAuthoredTask.count({ where: { clientId, bundleSha256: sha } })]);
    return runs + tasks > 0;
  }
  return null;
}

/**
 * D-22, architecture section 7 step 4: deletes bundle objects that no record references and that are older than 24
 * hours (a failed Save & Commit leaves its upload behind; younger objects may belong to a commit still in flight).
 * Objects whose key does not follow a known bundle layout are never touched. One audit event per client.
 */
export async function sweepBundles(db: Db, store: BundleObjectStore, opts: { now?: Date } = {}) {
  const cutoff = (opts.now ?? new Date()).getTime() - MAX_AGE_MS;
  const deleted = new Map<string, string[]>();
  let scanned = 0;
  for await (const o of store.list('bundles/')) {
    scanned++;
    if (o.updatedAt.getTime() > cutoff) continue;
    if ((await referenced(db, o.key)) !== false) continue;
    await store.delete(o.key);
    const clientId = (o.key.match(COMMITTED) ?? o.key.match(VERIFY))![1]!;
    deleted.set(clientId, [...(deleted.get(clientId) ?? []), o.key]);
  }
  for (const [clientId, keys] of deleted) {
    if (!(await db.client.findUnique({ where: { id: clientId } }))) continue;
    await db.$transaction((tx) => writeAudit(tx, { clientId, actorType: 'SYSTEM', actorId: BUNDLE_SWEEP_JOB }, { entityType: 'Client', entityId: clientId, action: 'studio.bundles_swept', after: { count: keys.length, keys: keys.slice(0, 500) } }));
  }
  return { scanned, deleted: [...deleted.values()].flat() };
}
