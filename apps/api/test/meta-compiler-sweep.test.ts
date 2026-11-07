import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StudioConfigResponse } from '@praxis/shared';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { GcsStorage } from '../src/candidate/storage';
import { MockRunner } from '../src/harbor/runner';
import { GcsBundleObjectStore, sweepBundles } from '../src/meta-compiler/bundle-sweep';
import { defaultAnswers } from '../src/meta-compiler/deps';
import { testSetupBlueprint } from '../src/meta-compiler/test-setup';
import { dbSelectionGate } from '../src/staffing/selection-gate';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { createClient, createUser, db, login, resetDb, testConfig } from './helpers';
import { api, workerFor } from './meta-compiler-fixtures';

const SECRET = 'test-mock-secret';
/** The fake GCS from docker-compose (as in infra.test.ts). */
const EMULATOR = process.env.GCS_EMULATOR_HOST || `http://localhost:${process.env.PRAXIS_GCS_PORT ?? 4443}`;

describe('A11 nightly sweep of unreferenced bundle objects, on the fake GCS (D-22)', () => {
  const bucket = `praxis-sweep-${randomUUID().slice(0, 8)}`;
  const gcs = { apiEndpoint: EMULATOR, projectId: 'praxis-test' };
  const storage = new GcsStorage(bucket, gcs);
  const store = new GcsBundleObjectStore(bucket, gcs);
  const google = new MockGoogleVerifier(SECRET);
  const config = testConfig({ MOCK_SECRET: SECRET });
  const runner = new MockRunner(storage);
  let app: FastifyInstance;
  let clientId: string;

  const keys = async () => {
    const out: string[] = [];
    for await (const o of store.list('')) out.push(o.key);
    return out.sort();
  };

  beforeAll(async () => {
    await storage.ensureBucket();
    await resetDb();
    clientId = (await createClient()).id;
    const admin = await createUser(clientId, ['ADMIN']);
    app = await buildApp({ config, db, pingRedis: async () => true, google, resolveClientId: async () => clientId, storage, embeddings: new HashingEmbeddingProvider(), selectionGate: dbSelectionGate, metaCompiler: { runner } });
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('deletes only unreferenced bundles older than 24 hours; referenced, young and unknown objects stay', async () => {
    // A real studio commit through the API: template verification bundle, committed bundle and its per-task copy.
    const http = api(app);
    const admin = await login(app, (await db.user.findFirstOrThrow({ where: { clientId } })).email);
    const s = (await http.post(admin, '/test-setup/meta-compiler')).json();
    const sme = await app.inject({ method: 'POST', url: '/api/v1/auth/google', payload: { credential: google.mint({ subject: `mock-${s.sme.email}`, email: s.sme.email, name: 'Test SME' }) } });
    const cookie = `praxis_candidate=${sme.cookies.find((x) => x.name === 'praxis_candidate')!.value}`;
    const cfg = StudioConfigResponse.parse((await app.inject({ method: 'GET', url: `/api/v1/candidate/studio/${s.studioKey}`, headers: { cookie } })).json());
    const answers = defaultAnswers(testSetupBlueprint());
    const rev = (await http.put(cookie, `/candidate/studio/${s.studioKey}/draft`, { answers, expectedRevision: cfg.revision })).json().revision;
    expect((await http.post(cookie, `/candidate/studio/${s.studioKey}/commit`, { expectedRevision: rev, dataClassification: 'SYNTHETIC' })).statusCode).toBe(200);
    await workerFor({ config, storage, runner })();
    const authored = await db.smeAuthoredTask.findFirstOrThrow();
    expect(authored.oracleScore).not.toBeNull();
    const verification = await db.compilerVerificationRun.findUniqueOrThrow({ where: { id: s.verificationRunId } });
    const kept = [authored.bundleRef, verification.bundleRef!, `bundles/verify/${clientId}/${authored.bundleSha256}.tar.gz`];

    // Leftovers of failed commits and verifications, an object of unknown layout and a non-bundle object.
    const sha = () => randomBytes(32).toString('hex');
    const orphans = [`bundles/${clientId}/${sha()}.tar.gz`, `bundles/verify/${clientId}/${sha()}.tar.gz`, `bundles/${randomUUID()}/${sha()}.tar.gz`];
    const untouched = ['bundles/README.txt', `generations/${clientId}/x/log.txt`];
    for (const k of [...orphans, ...untouched]) await storage.put(k, Buffer.from('synthetic'), 'application/octet-stream');
    const all = await keys();
    expect(all).toEqual(expect.arrayContaining([...kept, ...orphans, ...untouched]));

    // Everything is younger than 24 hours: nothing is deleted.
    expect((await sweepBundles(db, store)).deleted).toEqual([]);
    expect(await keys()).toEqual(all);

    // A day later: only the orphans go.
    const later = new Date(Date.now() + 25 * 3600_000);
    const r = await sweepBundles(db, store, { now: later });
    expect(r.deleted.sort()).toEqual([...orphans].sort());
    expect(await keys()).toEqual(all.filter((k) => !orphans.includes(k)));
    for (const k of kept) expect((await storage.get(k)).length).toBeGreaterThan(0);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: 'studio.bundles_swept', clientId } });
    expect(audit).toMatchObject({ actorType: 'SYSTEM', entityId: clientId, after: { count: 2 } });

    // Idempotent: a second run finds nothing more to delete.
    expect((await sweepBundles(db, store, { now: later })).deleted).toEqual([]);
    expect((await http.get(admin, `/studio-tasks/${authored.id}/bundle`)).statusCode).toBe(200);
  });
});
