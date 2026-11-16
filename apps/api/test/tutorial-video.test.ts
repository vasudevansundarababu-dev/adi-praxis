import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KYC_ACCOUNT_OPENING_PROFILE, MARKETING_CAMPAIGN_TASK2_PROFILE, TutorialScript, WAVE1_PROFILES, type TemplateProfile } from '@praxis/shared';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemorySignedStorage, MemoryStorage } from '../src/candidate/storage';
import { loadConfig, type Config } from '../src/config';
import { estimateUsd, spentTodayUsd } from '../src/forge/tutorial-video/cost';
import { chapterPlan, finalizeScript } from '../src/forge/tutorial-video/plan';
import { GeminiTutorialScriptDrafter, MockTutorialScriptDrafter } from '../src/forge/tutorial-video/script';
import { executeTutorialRun, servedTutorial, type TutorialPipeline, type TutorialSettings } from '../src/forge/tutorial-video/service';
import { cardText, captionsVtt, chapterMarkers, chapterSeconds, FfmpegStitcher, MockStitcher, wrap } from '../src/forge/tutorial-video/stitch';
import { CloudTextToSpeech, MockNarration, silentWav, wavSeconds } from '../src/forge/tutorial-video/tts';
import { ClipError, MockClipGenerator, VertexVeoClipGenerator } from '../src/forge/tutorial-video/veo';
import { tutorialSettings, tutorialVideoHandler } from '../src/forge/tutorial-video';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call } from './forge-helpers';
import { createUser, db, login, resetDb, testConfig } from './helpers';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env';

const SECRET = 'test-mock-secret';
const PROFILE = WAVE1_PROFILES.find((p) => p.profileId === 'kyb-and-beneficial-ownership')!;
const MARKETING = MARKETING_CAMPAIGN_TASK2_PROFILE;
const tpl = (p: TemplateProfile, profileId: string | null = null) => ({ workflowName: p.catalogWorkflowName, profileId, primaryWork: 'Author a synthetic case.', verificationCriteria: 'Checked by a reviewer.', humanGate: 'A reviewer approves every task.' });

// ── Pure parts: plan, script checks, timing, cost, config ──

describe('D2 chapter plan (template fields only)', () => {
  it.each([
    ['KYC (v6 / v7 form)', KYC_ACCOUNT_OPENING_PROFILE],
    ['Marketing (VEYRA)', MARKETING],
    ['KYB', PROFILE],
  ])('%s: an overview, then one chapter per section in form order, with every field as a card', (_n, p) => {
    const plan = chapterPlan(tpl(p, p.profileId), p);
    expect(plan).toHaveLength(p.sections.length + 1);
    expect(plan[0]!.title).toBe('Overview');
    expect(plan[0]!.cards.map((c) => c.label)).toEqual(p.sections.map((s, i) => `${i + 1}. ${s.title}`.replace(/\bAnvil\b/g, 'RL Gym').replace(/\bPraxis\b/g, 'ADI Forge')));
    p.sections.forEach((s, i) => {
      const ch = plan[i + 1]!;
      expect(ch.title).toBe(s.title.replace(/\bAnvil\b/g, 'RL Gym').replace(/\bPraxis\b/g, 'ADI Forge').slice(0, 100));
      expect(ch.cards).toHaveLength(Math.min(s.fields.length, 30));
      s.fields.slice(0, 30).forEach((f, j) => {
        expect(ch.cards[j]!.need).toMatch(/^(Required|Optional|Required in some cases)\./);
        if (f.example) expect(ch.cards[j]!.example.length).toBeGreaterThan(0);
      });
    });
    // Nothing a user sees names an internal system.
    expect(JSON.stringify(plan)).not.toMatch(/praxis|anvil|adi-labs/i);
  });

  it('the finalised script keeps the template titles and cards, and refuses internal names', async () => {
    const plan = chapterPlan(tpl(PROFILE), PROFILE);
    const { script } = await new MockTutorialScriptDrafter().draft({ workflowName: PROFILE.catalogWorkflowName, chapters: plan });
    const ok = finalizeScript({ chapters: script.chapters.map((c) => ({ ...c, title: 'Changed by the model' })) }, plan);
    expect('script' in ok && ok.script.chapters.map((c) => c.title)).toEqual(plan.map((c) => c.title));
    // publicText runs first: a plain "Anvil" becomes RL Gym and passes.
    const replaced = finalizeScript({ chapters: script.chapters.map((c, i) => (i === 1 ? { ...c, narration: 'Results go to Anvil for grading.' } : c)) }, plan);
    expect('script' in replaced && replaced.script.chapters[1]!.narration).toBe('Results go to RL Gym for grading.');
    for (const bad of ['Open praxis-web now.', 'Made by ADI Labs.', 'The ANVIL-QA export.']) {
      const r = finalizeScript({ chapters: script.chapters.map((c, i) => (i === 2 ? { ...c, narration: bad } : c)) }, plan);
      expect(r).toEqual({ problem: expect.stringMatching(/internal system/) });
    }
    const scene = finalizeScript({ chapters: script.chapters.map((c, i) => (i === 0 ? { ...c, scenes: ['Praxis logo on a wall', 'desk'] } : c)) }, plan);
    expect(scene).toEqual({ problem: expect.stringMatching(/scene prompt/) });
    expect(finalizeScript({ chapters: script.chapters.slice(1) }, plan)).toEqual({ problem: expect.stringMatching(/chapters/) });
  });
});

describe('D2 timing, captions and cost', () => {
  it('chapter length covers clips, narration and cards; markers and captions follow', () => {
    expect(chapterSeconds({ audioSeconds: 5, cards: [] })).toBe(16);
    expect(chapterSeconds({ audioSeconds: 40.2, cards: [1, 2] })).toBe(42);
    expect(chapterSeconds({ audioSeconds: 10, cards: Array(10).fill(0) })).toBe(43);
    const chapters = [
      { title: 'Overview', narration: 'Hello there. This is the overview!', audioSeconds: 20, cards: [] },
      { title: 'S1', narration: 'One sentence --> only', audioSeconds: 30, cards: [] },
    ];
    expect(chapterMarkers(chapters)).toEqual({ markers: [{ title: 'Overview', at: 0 }, { title: 'S1', at: 21 }], durationSeconds: 52 });
    const vtt = captionsVtt(chapters);
    expect(vtt.startsWith('WEBVTT\n')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> ');
    expect(vtt).toContain('00:00:21.000 --> 00:00:51.000\nOne sentence → only');
    expect(wrap('aaa bbb ccc ddd', 7)).toBe('aaa bbb\nccc ddd');
    const long = cardText({ label: 'L'.repeat(100), need: 'need '.repeat(200), example: 'example '.repeat(100) });
    expect(long.split('\n').length).toBeLessThanOrEqual(10);
  });

  it('estimate: 2 clips of 8 s per chapter at the Veo price, worst case with one retry each', () => {
    const cfg = testConfig().tutorial;
    expect(estimateUsd(cfg, 9)).toEqual({ expected: 9 * (16 * 0.08 + 0.05), worstCase: 9 * (32 * 0.08 + 0.05) });
  });

  it('config: live is refused in tests and locally, needs both caps and a bucket; publish triggers only in staging/production', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL };
    expect(() => loadConfig({ ...base, TUTORIAL_VIDEO_LIVE: 'true', TUTORIAL_VIDEO_COST_CAP_USD: '40', TUTORIAL_VIDEO_DAILY_CAP_USD: '100', VERTEX_PROJECT_ID: 'p', TUTORIAL_BUCKET: 'b' })).toThrow(/never allowed in tests/);
    const deployed = { ...base, NODE_ENV: 'development', APP_ENV: 'demo', MOCK_SECRET: 'x'.repeat(40), VERTEX_PROJECT_ID: 'p', TUTORIAL_VIDEO_LIVE: 'true' };
    expect(() => loadConfig(deployed)).toThrow(/needs TUTORIAL_VIDEO_COST_CAP_USD/);
    expect(() => loadConfig({ ...deployed, TUTORIAL_VIDEO_COST_CAP_USD: '40', TUTORIAL_VIDEO_DAILY_CAP_USD: '100' })).toThrow(/needs TUTORIAL_BUCKET/);
    expect(loadConfig({ ...deployed, TUTORIAL_VIDEO_COST_CAP_USD: '40', TUTORIAL_VIDEO_DAILY_CAP_USD: '100', TUTORIAL_BUCKET: 'b' }).tutorial).toMatchObject({ live: true, onPublish: false, costCapUsd: 40, dailyCapUsd: 100, bucket: 'b' });
    expect(() => loadConfig({ ...base, TUTORIAL_VIDEO_COST_CAP_USD: '-1' })).toThrow(/positive number/);
    expect(loadConfig({ ...base, APP_ENV: 'staging' }).tutorial.onPublish).toBe(true);
    expect(loadConfig({ ...base }).tutorial).toMatchObject({ live: false, onPublish: false, costCapUsd: null, dailyCapUsd: null, veoModel: 'veo-3.1-fast-generate-001', scriptModel: 'gemini-2.5-flash' });
    expect(loadConfig({ ...base, AUTHORING_MODEL: 'gemini:gemini-3-pro' }).tutorial.scriptModel).toBe('gemini-3-pro');
    expect(() => loadConfig({ ...base, TUTORIAL_SCRIPT_MODEL: 'claude-opus-5' })).toThrow(/gemini:<model>/);
  });
});

// ── Clients with stand-in fetch (never a network call) ──

describe('D2 model clients against stand-in fetch', () => {
  type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
  const fake = (answers: unknown[]) => {
    const calls: Call[] = [];
    const fetch = async (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      const a = answers.shift();
      return { ok: a !== 500, status: a === 500 ? 500 : 200, json: async () => a };
    };
    return { calls, fetch };
  };

  it('Veo: starts a long-running prediction (720p, 8 s, no audio, no people) and polls until done', async () => {
    const f = fake([{ name: 'op/1' }, { done: false }, { done: true, response: { videos: [{ bytesBase64Encoded: Buffer.from('clip').toString('base64') }] } }]);
    const veo = new VertexVeoClipGenerator('veo-3.1-fast-generate-001', { projectId: 'p', location: 'us-central1', fetch: f.fetch, token: async () => 't', sleep: async () => undefined });
    expect((await veo.generate('A calm desk', 8)).toString()).toBe('clip');
    expect(f.calls[0]!.url).toBe('https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001:predictLongRunning');
    expect(f.calls[0]!.body).toMatchObject({ instances: [{ prompt: 'A calm desk' }], parameters: { durationSeconds: 8, resolution: '720p', aspectRatio: '16:9', generateAudio: false, sampleCount: 1, personGeneration: 'dont_allow' } });
    expect(String((f.calls[0]!.body.parameters as { negativePrompt: string }).negativePrompt)).toMatch(/text.*logos/);
    expect(f.calls[1]!.url).toMatch(/:fetchPredictOperation$/);
    expect(f.calls[1]!.body).toEqual({ operationName: 'op/1' });
    const filtered = fake([{ name: 'op/2' }, { done: true, response: { raiMediaFilteredCount: 1 } }]);
    const v2 = new VertexVeoClipGenerator('m', { projectId: 'p', location: 'l', fetch: filtered.fetch, token: async () => 't', sleep: async () => undefined });
    await expect(v2.generate('x', 8)).rejects.toMatchObject({ name: 'ClipError', filtered: true });
    const failed = fake([500]);
    await expect(new VertexVeoClipGenerator('m', { projectId: 'p', location: 'l', fetch: failed.fetch, token: async () => 't' }).generate('x', 8)).rejects.toThrow(/Veo call failed \(500\)/);
  });

  it('Text-to-Speech: LINEAR16 at 24 kHz with the chosen voice; length from the WAV', async () => {
    const wav = silentWav(2.5);
    expect(wavSeconds(wav)).toBeCloseTo(2.5);
    const f = fake([{ audioContent: wav.toString('base64') }]);
    const tts = new CloudTextToSpeech('en-US-Chirp3-HD-Achernar', { projectId: 'p', fetch: f.fetch, token: async () => 't' });
    expect((await tts.synthesize('Hello')).seconds).toBeCloseTo(2.5);
    expect(f.calls[0]!.body).toEqual({ input: { text: 'Hello' }, voice: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Achernar' }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 } });
    expect(f.calls[0]!.headers['x-goog-user-project']).toBe('p');
  });

  it('script drafter: Gemini on Vertex with the public-names rule in the system prompt; output must match the schema', async () => {
    const plan = chapterPlan(tpl(PROFILE), PROFILE);
    const { script } = await new MockTutorialScriptDrafter().draft({ workflowName: 'w', chapters: plan });
    const f = fake([{ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(script) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } }, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"chapters":[]}' }] } }] }]);
    const d = new GeminiTutorialScriptDrafter('gemini-2.5-flash', { projectId: 'p', location: 'global', fetch: f.fetch, token: async () => 't' });
    expect(TutorialScript.parse((await d.draft({ workflowName: 'w', chapters: plan })).script)).toEqual(script);
    const sys = (f.calls[0]!.body.systemInstruction as { parts: { text: string }[] }).parts[0]!.text;
    expect(sys).toMatch(/Never write the words Praxis, Anvil or ADI-Labs/);
    expect(sys).toMatch(/No readable text/);
    await expect(d.draft({ workflowName: 'w', chapters: plan })).rejects.toThrow();
  });
});

// ffmpeg is in the API/worker image (Debian, with drawtext). This check runs locally when an ffmpeg with drawtext is
// available (D2_FFMPEG / D2_FFPROBE / D2_FONT may point at the image's), never in CI.
const FFMPEG = process.env.D2_FFMPEG ?? 'ffmpeg';
const FFPROBE = process.env.D2_FFPROBE ?? 'ffprobe';
const hasFfmpeg = (() => {
  if (process.env.CI) return false;
  try {
    return execFileSync(FFMPEG, ['-hide_banner', '-filters'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().includes('drawtext');
  } catch {
    return false;
  }
})();
describe.skipIf(!hasFfmpeg)('D2 ffmpeg stitch (local only)', () => {
  it('joins clips, narration and cards into one MP4 with chapter metadata', async () => {
    const { mkdtempSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = mkdtempSync(path.join(tmpdir(), 'd2-clip-'));
    const clip = (color: string) => {
      const f = path.join(dir, `${color}.mp4`);
      execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:d=1:r=24`, '-pix_fmt', 'yuv420p', f]);
      return readFileSync(f);
    };
    const chapters = ['navy', 'teal'].map((color, i) => ({ title: i ? "Section 1: it's 50% done" : 'Overview', narration: 'A short line. Another one.', cards: [{ label: 'Field: name', need: "Required. Use a made-up name, e.g. 'Ada'.", example: 'Ada Lovelace Ltd' }], clips: [clip(color), clip(color)], audio: silentWav(2), audioSeconds: 2 }));
    const out = await new FfmpegStitcher({ ffmpeg: FFMPEG, font: process.env.D2_FONT }).stitch(chapters);
    expect(out.chapters).toEqual([{ title: 'Overview', at: 0 }, { title: "Section 1: it's 50% done", at: 16 }]);
    const f = path.join(dir, 'out.mp4');
    (await import('node:fs')).writeFileSync(f, out.video);
    const probe = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_chapters', '-show_format', '-of', 'json', f]).toString()) as { chapters: { tags: { title: string } }[]; format: { duration: string } };
    expect(probe.chapters.map((c) => c.tags.title)).toEqual(['Overview', "Section 1: it's 50% done"]);
    expect(Number(probe.format.duration)).toBeGreaterThan(31);
  }, 120_000);
});

// ── The whole flow through the API, with the mock pipeline ──

describe('D2 tutorial video runs through the API', () => {
  let app: FastifyInstance;
  let config: Config;
  let settings: TutorialSettings;
  const tutorialStorage = new MemorySignedStorage();
  let clientId: string;
  let admin: string;
  let pm: string;
  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  const pipeline = (o: Partial<TutorialPipeline> = {}): TutorialPipeline => ({ script: new MockTutorialScriptDrafter(), clips: new MockClipGenerator(), narration: new MockNarration(), stitcher: new MockStitcher(), storage: tutorialStorage, settings, concurrency: 2, ...o });
  const runAll = async (p = pipeline()) => {
    const events = await db.outboxEvent.findMany({ where: { name: 'template.tutorial_requested' }, orderBy: { createdAt: 'asc' } });
    const h = tutorialVideoHandler(p);
    for (const e of events) await h.run!(e, db);
  };

  beforeAll(async () => {
    config = testConfig();
    app = await buildApp({ config, db, pingRedis: async () => true, google: new MockGoogleVerifier(SECRET), identity: new MockIdentityProvider(SECRET, 'http://candidate.test'), resolveClientId: async () => clientId, storage: new MemoryStorage(), tutorialStorage, email: new MemoryEmailSender(), embeddings: new HashingEmbeddingProvider() });
    // The same read-through settings the app uses: tests change caps, the paid switch and the environment on the
    // config. The pipeline is always the mocks below; nothing here can reach Vertex.
    settings = tutorialSettings(config);
  });
  beforeEach(async () => {
    await resetDb();
    tutorialStorage.objects.clear();
    Object.assign(config.tutorial, testConfig().tutorial);
    (config as { appEnv: Config['appEnv'] }).appEnv = 'local';
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function template(publish = true) {
    const domainId = (await post(admin, '/domains', { name: `Banking ${randomUUID().slice(0, 4)}` })).json().id;
    const t = (
      await post(admin, '/templates', {
        domainId,
        workflowName: PROFILE.catalogWorkflowName,
        primaryWork: 'Author a realistic synthetic case with its reference solution and rubric.',
        verificationCriteria: 'Evidence, reference and rubric are consistent.',
        humanGate: 'A reviewer approves every task; the agent only recommends.',
        defaultTptMinutes: 60,
        skills: ['KYC'],
        taskModes: ['AUTHORING'],
        coverageDimensions: { dimensions: [{ key: 'risk_level', label: 'Risk level', values: ['low', 'high'] }], cells: [{ tags: { risk_level: 'high' }, quota: 1, required: true }] },
        edgeCaseCatalog: [],
      })
    ).json();
    if (publish) expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    return t.id as string;
  }
  const runs = async (id: string) => (await get(admin, `/templates/${id}/tutorial/runs`)).json();
  const audits = (action: string) => db.auditEvent.findMany({ where: { clientId, action }, orderBy: { createdAt: 'asc' } });

  it('QA and local never generate on publish; the Admin button does, once per workflow at a time', async () => {
    const id = await template();
    expect(await db.templateTutorialRun.count()).toBe(0);
    expect(await audits('template.tutorial_refused')).toHaveLength(0);

    const before = await runs(id);
    expect(before.runs).toEqual([]);
    expect(before.generation).toMatchObject({ blockedReason: null, live: false, chapters: PROFILE.sections.length + 1 });

    const g = await post(admin, `/templates/${id}/tutorial/generate`);
    expect(g.statusCode, g.body).toBe(202);
    expect(g.json()).toMatchObject({ outcome: 'started', run: { status: 'QUEUED', trigger: 'ADMIN', templateVersion: 1 } });
    const again = await post(admin, `/templates/${id}/tutorial/generate`);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ outcome: 'existing', run: { id: g.json().run.id } });
    expect(await db.templateTutorialRun.count()).toBe(1);
    expect(await db.outboxEvent.count({ where: { name: 'template.tutorial_requested' } })).toBe(1);
    expect((await runs(id)).generation.blockedReason).toMatch(/already being made/);
    const [req] = await audits('template.tutorial_requested');
    expect(req).toMatchObject({ actorType: 'USER', entityId: g.json().run.id, after: { trigger: 'ADMIN', version: 1, chapters: PROFILE.sections.length + 1 } });
  });

  it('staging and production: publish starts a run; a refused or failing video never blocks publish', async () => {
    (config as { appEnv: Config['appEnv'] }).appEnv = 'staging';
    settings.tutorial.onPublish = true;
    try {
      // Generation off in staging (not live): publish succeeds; the refusal is audited.
      const off = await template();
      expect((await db.template.findUniqueOrThrow({ where: { id: off } })).status).toBe('PUBLISHED');
      expect((await audits('template.tutorial_refused'))[0]).toMatchObject({ entityId: off, after: { trigger: 'PUBLISH', reason: expect.stringMatching(/switched off/) } });
      expect(await db.templateTutorialRun.count()).toBe(0);

      // Live with caps: publish starts a run.
      Object.assign(settings.tutorial, { live: true, costCapUsd: 40, dailyCapUsd: 100 });
      const on = await template();
      const [run] = await db.templateTutorialRun.findMany({ where: { templateId: on } });
      expect(run).toMatchObject({ trigger: 'PUBLISH', status: 'QUEUED', videoModel: 'veo-3.1-fast-generate-001' });
      expect(await db.outboxEvent.count({ where: { name: 'template.tutorial_requested', aggregateId: run!.id } })).toBe(1);

      // The run fails (every clip refused): the template stays published, with no tutorial.
      await runAll(pipeline({ clips: new MockClipGenerator(() => new ClipError('Veo filtered the clip', true)) }));
      const failed = await db.templateTutorialRun.findUniqueOrThrow({ where: { id: run!.id } });
      expect(failed).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/could not be made/) });
      expect(await db.template.findUniqueOrThrow({ where: { id: on } })).toMatchObject({ status: 'PUBLISHED', tutorialVideoUrl: null });
      expect((await audits('template.tutorial_failed'))[0]).toMatchObject({ actorType: 'SYSTEM', entityId: run!.id });

      // A cap refusal on publish is audited; publish still succeeds.
      settings.tutorial.costCapUsd = 1;
      const capped = await template();
      expect((await db.template.findUniqueOrThrow({ where: { id: capped } })).status).toBe('PUBLISHED');
      expect((await audits('template.tutorial_refused')).at(-1)).toMatchObject({ entityId: capped, after: { reason: expect.stringMatching(/per-video cap/) } });
    } finally {
      (config as { appEnv: Config['appEnv'] }).appEnv = 'local';
    }
  });

  it('nothing reaches SMEs or Reviewers until an Admin approves; regenerating keeps the approved video', async () => {
    const id = await template();
    const first = (await post(admin, `/templates/${id}/tutorial/generate`)).json().run.id;
    await runAll();
    const ready = (await runs(id)).runs[0];
    expect(ready).toMatchObject({ id: first, status: 'READY_FOR_REVIEW', previewUrl: expect.stringMatching(/^https:\/\/storage\.test\/tutorials\/.+\/tutorial\.mp4/), captionsUrl: expect.stringMatching(/captions\.vtt/) });
    expect(ready.chapters[0]).toEqual({ title: 'Overview', at: 0 });
    expect(ready.chapters).toHaveLength(PROFILE.sections.length + 1);
    expect(ready.script.chapters).toHaveLength(PROFILE.sections.length + 1);
    const lineageId = (await db.template.findUniqueOrThrow({ where: { id } })).lineageId;
    expect([...tutorialStorage.objects.keys()].sort()).toEqual([`tutorials/${lineageId}/${first}/captions.vtt`, `tutorials/${lineageId}/${first}/tutorial.mp4`]);
    expect(tutorialStorage.objects.get([...tutorialStorage.objects.keys()].find((k) => k.endsWith('.vtt'))!)!.data.toString()).toMatch(/^WEBVTT/);
    // Not on the template yet: SMEs and Reviewers see no tutorial.
    expect((await get(admin, `/templates/${id}`)).json().tutorial).toBeNull();
    expect((await audits('template.tutorial_generated'))[0]).toMatchObject({ actorType: 'SYSTEM', after: { status: 'READY_FOR_REVIEW' } });

    // A PM can neither approve nor generate.
    expect((await post(pm, `/tutorial-runs/${first}/approve`)).statusCode).toBe(403);
    expect((await post(pm, `/templates/${id}/tutorial/generate`)).statusCode).toBe(403);
    expect((await get(pm, `/templates/${id}/tutorial/runs`)).statusCode).toBe(403);

    const ok = await post(admin, `/tutorial-runs/${first}/approve`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('APPROVED');
    const approvedUrl = (await db.template.findUniqueOrThrow({ where: { id } })).tutorialVideoUrl!;
    expect(approvedUrl).toMatch(/^storage:tutorials\/.+\/tutorial\.mp4$/);
    expect((await get(admin, `/templates/${id}`)).json().tutorial.chapters).toEqual(ready.chapters);
    // What SMEs and Reviewers get: a signed address with captions.
    const served = await servedTutorial({ videoUrl: approvedUrl, chapters: ready.chapters });
    expect(served).toMatchObject({ videoUrl: expect.stringMatching(/^https:\/\/storage\.test\/tutorials\/.+\/tutorial\.mp4\?action=read&expires=43200$/), captionsUrl: expect.stringMatching(/captions\.vtt/) });
    expect((await post(admin, `/tutorial-runs/${first}/approve`)).statusCode).toBe(409);
    expect((await audits('template.tutorial_approved'))[0]).toMatchObject({ actorType: 'USER', entityId: first });

    // Regenerate, then reject: the approved video stays.
    const second = (await post(admin, `/templates/${id}/tutorial/generate`)).json().run.id;
    await runAll();
    expect((await db.template.findUniqueOrThrow({ where: { id } })).tutorialVideoUrl).toBe(approvedUrl);
    expect((await post(admin, `/tutorial-runs/${second}/reject`, { reason: 'x' })).statusCode).toBe(400);
    const rej = await post(admin, `/tutorial-runs/${second}/reject`, { reason: 'The narration is too fast.' });
    expect(rej.json()).toMatchObject({ status: 'REJECTED', rejectReason: 'The narration is too fast.' });
    expect((await db.template.findUniqueOrThrow({ where: { id } })).tutorialVideoUrl).toBe(approvedUrl);

    // Regenerate again and approve: the new one replaces the old; the old run is superseded.
    const third = (await post(admin, `/templates/${id}/tutorial/generate`)).json().run.id;
    await runAll();
    expect((await post(admin, `/tutorial-runs/${third}/approve`)).statusCode).toBe(200);
    expect((await db.template.findUniqueOrThrow({ where: { id } })).tutorialVideoUrl).toContain(third);
    expect((await db.templateTutorialRun.findUniqueOrThrow({ where: { id: first } })).status).toBe('SUPERSEDED');
  });

  it('approval applies to the run version and later versions, not earlier ones', async () => {
    const v1 = await template();
    const v2 = (await post(admin, `/templates/${v1}/versions`)).json().id;
    expect((await post(admin, `/templates/${v2}/publish`)).statusCode).toBe(200);
    // A draft can't get a tutorial run.
    const v3 = (await post(admin, `/templates/${v2}/versions`)).json().id;
    const draft = await post(admin, `/templates/${v3}/tutorial/generate`);
    expect(draft.statusCode).toBe(409);
    expect(draft.json()).toMatchObject({ outcome: 'refused', reason: expect.stringMatching(/Publish this version first/) });
    const run = (await post(admin, `/templates/${v2}/tutorial/generate`)).json().run.id;
    await runAll();
    expect((await post(admin, `/tutorial-runs/${run}/approve`)).statusCode).toBe(200);
    const url = async (tid: string) => (await db.template.findUniqueOrThrow({ where: { id: tid } })).tutorialVideoUrl;
    expect(await url(v1)).toBeNull();
    expect(await url(v2)).toContain(run);
    expect(await url(v3)).toContain(run);
  });

  it('caps: per-video and daily refusals, a mid-run stop, and the reservation is released', async () => {
    Object.assign(settings.tutorial, { live: true, costCapUsd: null, dailyCapUsd: null });
    const a = await template();
    // Live without caps: refused.
    const noCaps = await post(admin, `/templates/${a}/tutorial/generate`);
    expect(noCaps.statusCode).toBe(409);
    expect(noCaps.json().reason).toMatch(/needs both cost caps/);

    const worst = estimateUsd(settings.tutorial, PROFILE.sections.length + 1).worstCase;
    Object.assign(settings.tutorial, { costCapUsd: worst - 0.01, dailyCapUsd: 1000 });
    const perVideo = await post(admin, `/templates/${a}/tutorial/generate`);
    expect(perVideo.json()).toMatchObject({ outcome: 'refused', reason: expect.stringMatching(/per-video cap/) });
    expect((await audits('template.tutorial_refused')).at(-1)).toMatchObject({ actorType: 'USER', entityId: a });

    // Daily cap fits one worst case: of two concurrent requests for two workflows, exactly one starts.
    Object.assign(settings.tutorial, { costCapUsd: worst, dailyCapUsd: worst * 1.5 });
    const b = await template();
    const both = await Promise.all([post(admin, `/templates/${a}/tutorial/generate`), post(admin, `/templates/${b}/tutorial/generate`)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([202, 409]);
    expect(both.find((r) => r.statusCode === 409)!.json().reason).toMatch(/Today's tutorial budget/);
    expect(await spentTodayUsd(db)).toBeCloseTo(worst);

    // Mid-run stop: the cap is lowered after the request; the run stops before going over it.
    settings.tutorial.costCapUsd = 3;
    await runAll();
    const [run] = await db.templateTutorialRun.findMany({ where: { status: { not: 'QUEUED' } } });
    expect(run).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/per-video cost cap of \$3\.00 was reached/) });
    expect(Number(run!.actualUsd)).toBeLessThanOrEqual(3);
    const spend = await db.tutorialSpend.findMany({ where: { runId: run!.id } });
    expect(spend.filter((s) => s.kind === 'release')).toHaveLength(1);
    // The day's committed spend is now only what was actually billed.
    expect(await spentTodayUsd(db)).toBeCloseTo(Number(run!.actualUsd));
  });

  it('a successful run bills the script, the clips and the narration, and retries a refused clip once with a safe scene', async () => {
    Object.assign(settings.tutorial, { live: true, costCapUsd: 40, dailyCapUsd: 100 });
    const id = await template();
    const runId = (await post(admin, `/templates/${id}/tutorial/generate`)).json().run.id;
    let refused = 0;
    const clips = new MockClipGenerator((prompt, attempt) => (prompt.startsWith('Calm abstract office scene about overview') && attempt === 1 && ++refused ? new ClipError('Veo filtered the clip', true) : null));
    await runAll(pipeline({ clips }));
    const run = await db.templateTutorialRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('READY_FOR_REVIEW');
    const chapters = PROFILE.sections.length + 1;
    expect(refused).toBe(1);
    expect(clips.prompts).toHaveLength(chapters * 2 + 1);
    expect(clips.prompts).toContain('Calm abstract office background with soft daylight and a slow camera move. No text, no screens, no people.');
    const cfg = settings.tutorial;
    expect(Number(run.actualUsd)).toBeCloseTo(chapters * cfg.textPricePerChapter + (chapters * 2 + 1) * 8 * cfg.veoPricePerSecond, 3);
    const kinds = (await db.tutorialSpend.findMany({ where: { runId } })).map((s) => s.kind);
    expect(kinds.filter((k) => k === 'reserve')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'release')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'actual')).toHaveLength(1 + chapters * 2 + 1 + chapters);
    // A redelivered event does nothing.
    await runAll(pipeline({ clips }));
    expect(clips.prompts).toHaveLength(chapters * 2 + 1);
  });

  it('a script that names an internal system fails the run; nothing is made from it', async () => {
    const id = await template();
    const runId = (await post(admin, `/templates/${id}/tutorial/generate`)).json().run.id;
    const leaky = new MockTutorialScriptDrafter();
    const draft = leaky.draft.bind(leaky);
    leaky.draft = async (input) => {
      const out = await draft(input);
      out.script.chapters[0]!.narration = 'Welcome to praxis-web, by adi labs.';
      return out;
    };
    const clips = new MockClipGenerator();
    await runAll(pipeline({ script: leaky, clips }));
    expect(await db.templateTutorialRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/internal system/) });
    expect(clips.prompts).toHaveLength(0);
    expect(tutorialStorage.objects.size).toBe(0);
  });

  it('the spend ledger is append-only in the database', async () => {
    const id = await template();
    const runId = (await post(admin, `/templates/${id}/tutorial/generate`)).json().run.id;
    await expect(db.$executeRawUnsafe(`UPDATE "TutorialSpend" SET amount_usd = 0 WHERE run_id = '${runId}'`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`DELETE FROM "TutorialSpend" WHERE run_id = '${runId}'`)).rejects.toThrow();
    expect(await db.tutorialSpend.count({ where: { runId } })).toBe(1);
  });

  it('a template without a sections form cannot get a tutorial', async () => {
    const id = await template();
    await db.template.update({ where: { id }, data: { workflowName: `No form ${randomUUID().slice(0, 4)}` } });
    const r = await post(admin, `/templates/${id}/tutorial/generate`);
    expect(r.statusCode).toBe(409);
    expect(r.json().reason).toMatch(/no sections form/);
  });
});
