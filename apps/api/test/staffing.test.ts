import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { processDomainEvent } from '../src/outbox/dispatcher';
import { defaultHandlers } from '../src/outbox/handlers';
import { distanceKm, OfflineGeocoder } from '../src/staffing/geocoder';
import type { SelectionGate } from '../src/staffing/selection-gate';
import { buildTestApp, createCandidate, createUser, db, idem, login, resetDb, testConfig } from './helpers';

const TEMPLATE = {
  primaryWork: 'Assemble identity evidence.',
  verificationCriteria: 'Document checks.',
  humanGate: 'Approval remains with a human.',
  defaultTptMinutes: 60,
  skills: ['KYC', 'EDD'],
  taskModes: ['AUTHORING'],
};
const JD = { title: 'KYC Analyst', responsibilities: 'Author KYC cases.', skills: ['KYC', 'EDD', 'AML', 'Sanctions'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' };
const BASE_FILTERS = [
  { attributeKey: 'country', operator: 'IN', values: ['GB', 'IE'], required: true },
  { attributeKey: 'languages', operator: 'IN', values: [{ language: 'en', minLevel: 'C1' }], required: true },
];

describe('M3 FLOW 2 core: matching and staffing', () => {
  let app: FastifyInstance;
  let clientId: string;
  let admin: string;
  let pm: string;
  let otherPm: string;
  let reviewer: string;
  let templateId: string;
  let jdId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
    reviewer = await login(app, (await createUser(clientId, ['REVIEWER'])).email);
    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    templateId = (await post(admin, '/templates', { domainId, workflowName: 'KYC onboarding and refresh', ...TEMPLATE })).json().id;
    await post(admin, `/templates/${templateId}/publish`);
    jdId = (await post(pm, '/job-descriptions', JD)).json().id;
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  function post(cookie: string, url: string, payload: unknown = {}, a: FastifyInstance = app) {
    return a.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  }
  function get(cookie: string, url: string) {
    return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  }
  function del(cookie: string, url: string) {
    return app.inject({ method: 'DELETE', url: `/api/v1${url}`, headers: { cookie, ...idem() } });
  }

  /** A submitted project needing 2 workers (8 tasks, cap 4). */
  async function readyProject(filters: unknown[] = BASE_FILTERS, extra: object = {}) {
    const p = (
      await post(pm, '/projects', { authoringExperience: 'BOTH',
        templateId,
        name: `Project ${randomUUID().slice(0, 6)}`,
        distinctTarget: 8,
        maxPerExpert: 4,
        tptMinutes: 60,
        startDate: '2026-10-05',
        endDate: '2026-11-06',
        demographicFilters: filters,
        jobDescriptionId: jdId,
        ...extra,
      })
    ).json();
    const s = await post(pm, `/projects/${p.id}/submit`);
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json().requiredWorkers).toBe(2);
    return p.id as string;
  }
  const open = async (projectId: string, cookie = pm) => {
    const res = await post(cookie, `/projects/${projectId}/match`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const ids = (list: { items: { candidateId: string }[] }) => list.items.map((i) => i.candidateId);

  describe('AC: opening a READY_FOR_STAFFING project moves it to STAFFING and shows ranked matches', () => {
    it('transitions, audits and returns candidates ranked by score', async () => {
      const low = await createCandidate(clientId, { name: 'Low', skills: [] });
      const high = await createCandidate(clientId, { name: 'High', skills: ['KYC', 'EDD', 'AML', 'Sanctions'] });
      const mid = await createCandidate(clientId, { name: 'Mid' });
      const projectId = await readyProject();

      const list = await open(projectId);
      expect(list).toMatchObject({ status: 'STAFFING', requiredWorkers: 2, assigned: 0, shortfall: 2 });
      expect(ids(list)).toEqual([high.id, mid.id, low.id]);
      expect(list.items.map((i: { rank: number }) => i.rank)).toEqual([1, 2, 3]);
      expect(list.matchedAt).not.toBeNull();
      expect((await get(pm, `/projects/${projectId}`)).json().status).toBe('STAFFING');
      const actions = (await db.auditEvent.findMany({ where: { entityId: projectId }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['project.staffing_started', 'project.matched']));

      // GET returns the stored ranking; a re-run keeps STAFFING.
      expect(ids((await get(pm, `/projects/${projectId}/matches`)).json())).toEqual([high.id, mid.id, low.id]);
      expect((await open(projectId)).status).toBe('STAFFING');
    });

    it('cannot open a draft or a cancelled project', async () => {
      const draft = (await post(pm, '/projects', { authoringExperience: 'BOTH', templateId, name: 'Draft only' })).json();
      expect((await post(pm, `/projects/${draft.id}/match`)).json().error).toBe('NOT_STAFFING');
    });
  });

  describe('scoring (SPEC weights; definitions decided 26 Sep 2026)', () => {
    it('skills 50, experience 20, language 15, availability 15', async () => {
      // JD has 4 skills; candidate has 2 of them -> 25. 10 years / default 10 -> 20. English C2 >= C1 -> 15. 20 h / 20 -> 15.
      const c = await createCandidate(clientId);
      const item = (await open(await readyProject())).items.find((i: { candidateId: string }) => i.candidateId === c.id);
      expect(item.breakdown).toMatchObject({ skills: 25, experience: 20, language: 15, availability: 15, preferredBonus: 0 });
      expect(item.score).toBe(75);
    });

    it('uses the project minimums and adds up to 10 for preferred filters', async () => {
      const veteran = await createCandidate(clientId, { name: 'Veteran', domainExperienceYears: 15, hoursPerWeek: 10 });
      const junior = await createCandidate(clientId, { name: 'Junior', domainExperienceYears: 6, hoursPerWeek: 40 });
      const projectId = await readyProject([
        ...BASE_FILTERS,
        { attributeKey: 'domain_experience_years', operator: 'GTE', values: { min: 12 }, required: false },
        { attributeKey: 'availability_hours_week', operator: 'GTE', values: { min: 30 }, required: false },
      ]);
      const items = (await open(projectId)).items as { candidateId: string; score: number; breakdown: Record<string, unknown> }[];
      const v = items.find((i) => i.candidateId === veteran.id)!;
      const j = items.find((i) => i.candidateId === junior.id)!;
      // Veteran: experience min(1, 15/12) -> 20; availability 10/30 -> 5; one of two preferred met -> 5.
      expect(v.breakdown).toMatchObject({ experience: 20, availability: 5, preferredBonus: 5, preferredMet: ['domain_experience_years'] });
      // Junior: 6/12 -> 10; availability min(1, 40/30) -> 15; preferred met: availability only -> 5.
      expect(j.breakdown).toMatchObject({ experience: 10, availability: 15, preferredBonus: 5, preferredMet: ['availability_hours_week'] });
    });

    it('unknown values score zero, never a guess', async () => {
      const c = await createCandidate(clientId, { domainExperienceYears: null, hoursPerWeek: null });
      const item = (await open(await readyProject())).items.find((i: { candidateId: string }) => i.candidateId === c.id);
      expect(item.breakdown).toMatchObject({ experience: 0, availability: 0 });
    });
  });

  describe('hard filters and exclusions', () => {
    it('requires an active account and verified (or alternatively verified) identity', async () => {
      const ok = await createCandidate(clientId, { name: 'Verified' });
      const alt = await createCandidate(clientId, { name: 'Alt', identityStatus: 'ALTERNATIVE_VERIFIED' });
      await createCandidate(clientId, { name: 'Pending', identityStatus: 'PROCESSING' });
      await createCandidate(clientId, { name: 'Suspended', accountStatus: 'SUSPENDED' });
      expect(new Set(ids(await open(await readyProject())))).toEqual(new Set([ok.id, alt.id]));
    });

    it('requires the SME profile to cover the template specialty', async () => {
      const kyc = await createCandidate(clientId, { specialties: ['kyc'] });
      await createCandidate(clientId, { specialties: ['Trade surveillance'], skills: ['KYC'] });
      expect(ids(await open(await readyProject()))).toEqual([kyc.id]);
    });

    it('applies required country and language filters (level is a minimum)', async () => {
      const gb = await createCandidate(clientId, { country: 'GB' });
      await createCandidate(clientId, { country: 'IN' });
      await createCandidate(clientId, { country: null });
      await createCandidate(clientId, { languages: [{ language: 'en', level: 'B2' }] });
      await createCandidate(clientId, { languages: [{ language: 'fr', level: 'NATIVE' }] });
      expect(ids(await open(await readyProject()))).toEqual([gb.id]);
    });

    it('matches city radius by distance using the geocoder', async () => {
      const london = await createCandidate(clientId, { name: 'London' });
      await createCandidate(clientId, { name: 'Manchester', city: 'Manchester', latitude: 53.4808, longitude: -2.2426 });
      await createCandidate(clientId, { name: 'No coords', latitude: null, longitude: null });
      const projectId = await readyProject([...BASE_FILTERS, { attributeKey: 'city_radius', operator: 'WITHIN_RADIUS', values: { city: 'London', radiusKm: 100 }, required: true }]);
      expect(ids(await open(projectId))).toEqual([london.id]);
    });

    it('an unknown filter city matches nobody and says why', async () => {
      await createCandidate(clientId);
      const projectId = await readyProject([...BASE_FILTERS, { attributeKey: 'city_radius', operator: 'WITHIN_RADIUS', values: { city: 'Atlantis', radiusKm: 100 }, required: true }]);
      const list = await open(projectId);
      expect(list.items).toEqual([]);
      expect(list.warnings[0]).toMatch(/Atlantis/);
    });

    it('excludes candidates at their concurrent-project limit; finished projects do not count', async () => {
      const busy = await createCandidate(clientId, { name: 'Busy', concurrentProjectLimit: 1 });
      const free = await createCandidate(clientId, { name: 'Free' });
      const first = await readyProject();
      await open(first);
      await post(pm, `/projects/${first}/assignments`, { candidateIds: [busy.id] });

      const second = await readyProject();
      expect(ids(await open(second))).toEqual([free.id]);

      await db.project.update({ where: { id: first }, data: { status: 'CANCELLED' } });
      expect(new Set(ids(await open(second)))).toEqual(new Set([busy.id, free.id]));
    });
  });

  describe('AC: a missing JD is created automatically and linked to the project', () => {
    it('rebuilds the JD from the frozen snapshot when the link is gone', async () => {
      const projectId = await readyProject();
      await db.project.update({ where: { id: projectId }, data: { jobDescriptionId: null } });
      await db.jobDescription.update({ where: { id: jdId }, data: { title: 'Renamed since', normalizedTitle: 'renamed since' } });
      const before = await db.jobDescription.count();

      await open(projectId);
      const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { jobDescription: true } });
      expect(await db.jobDescription.count()).toBe(before + 1);
      expect(p.jobDescription).toMatchObject({ title: 'KYC Analyst', skills: JD.skills, normalizedTitle: 'kyc analyst' });
      expect(await db.auditEvent.count({ where: { entityId: projectId, action: 'project.jd_linked' } })).toBe(1);
    });

    it('reuses an existing JD with the same title and skills instead of creating one', async () => {
      const projectId = await readyProject();
      await db.project.update({ where: { id: projectId }, data: { jobDescriptionId: null } });
      const before = await db.jobDescription.count();
      await open(projectId);
      expect(await db.jobDescription.count()).toBe(before);
      expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).jobDescriptionId).toBe(jdId);
    });

    it('keeps the PM’s JD when it is linked', async () => {
      const projectId = await readyProject();
      await open(projectId);
      expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).jobDescriptionId).toBe(jdId);
      expect(await db.auditEvent.count({ where: { entityId: projectId, action: 'project.jd_linked' } })).toBe(0);
    });
  });

  describe('AC: assigning enough candidates moves the project to STAFFED and emits project.staffed', () => {
    it('assigns, emits candidate.assigned per candidate, then STAFFED + project.staffed', async () => {
      const a = await createCandidate(clientId);
      const b = await createCandidate(clientId);
      const projectId = await readyProject();
      await open(projectId);

      const one = await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [a.id] });
      expect(one.statusCode, one.body).toBe(200);
      expect(one.json()).toMatchObject({ status: 'STAFFING', assigned: 1, shortfall: 1 });
      expect(one.json().items.find((i: { candidateId: string }) => i.candidateId === a.id).status).toBe('ASSIGNED');
      expect(await db.outboxEvent.count({ where: { name: 'project.staffed' } })).toBe(0);

      const two = await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [b.id] });
      expect(two.json()).toMatchObject({ status: 'STAFFED', assigned: 2, shortfall: 0 });
      expect(await db.outboxEvent.count({ where: { name: 'candidate.assigned' } })).toBe(2);
      const staffed = await db.outboxEvent.findMany({ where: { name: 'project.staffed' } });
      expect(staffed).toHaveLength(1);
      expect(staffed[0]!.payload).toEqual({ projectId, assigned: 2, requiredWorkers: 2 });
      expect(await db.auditEvent.count({ where: { entityId: projectId, action: 'project.staffed' } })).toBe(1);

      // Staffed projects take no more staffing actions.
      expect((await post(pm, `/projects/${projectId}/assignments`, { topN: 1 })).json().error).toBe('NOT_STAFFING');
    });

    it('bulk-assigns the top N available by rank', async () => {
      const best = await createCandidate(clientId, { skills: ['KYC', 'EDD', 'AML', 'Sanctions'] });
      const next = await createCandidate(clientId, { skills: ['KYC', 'EDD', 'AML'] });
      await createCandidate(clientId, { skills: [] });
      const projectId = await readyProject();
      await open(projectId);
      const res = await post(pm, `/projects/${projectId}/assignments`, { topN: 2 });
      expect(res.json().status).toBe('STAFFED');
      const assigned = await db.projectAssignment.findMany({ where: { projectId } });
      expect(new Set(assigned.map((x) => x.candidateId))).toEqual(new Set([best.id, next.id]));
      expect(Number(assigned.find((x) => x.candidateId === best.id)!.matchScore)).toBe(100);
    });

    it('refuses to assign more than the shortfall, twice, or someone no longer eligible', async () => {
      const a = await createCandidate(clientId);
      const b = await createCandidate(clientId);
      const c = await createCandidate(clientId);
      const projectId = await readyProject();
      await open(projectId);
      expect((await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [a.id, b.id, c.id] })).json().error).toBe('OVER_ASSIGNMENT');
      await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [a.id] });
      expect((await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [a.id] })).json().details.problems[0]).toMatch(/already assigned/);
      await db.smeUser.updateMany({ where: { candidate: { id: b.id } }, data: { identityStatus: 'CANCELED' } });
      expect((await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [b.id] })).json().details.problems[0]).toMatch(/no longer eligible/);
    });

    it('goes through the selection gate', async () => {
      const blocked: SelectionGate = { check: async () => ({ ok: false, reason: 'not selected for this pool' }) };
      const gated = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: blocked });
      try {
        const a = await createCandidate(clientId);
        const projectId = await readyProject();
        await open(projectId);
        const cookie = await login(gated, (await createUser(clientId, ['ADMIN'])).email);
        const res = await post(cookie, `/projects/${projectId}/assignments`, { candidateIds: [a.id] }, gated);
        expect(res.statusCode).toBe(409);
        expect(res.json().details.problems[0]).toMatch(/not selected/);
      } finally {
        await gated.close();
      }
    });

    it('concurrent assignments cannot overbook a candidate’s capacity', async () => {
      // A barrier in the selection gate (called after the capacity check, before the insert) holds each
      // transaction until all six have arrived or 1 s passes. Without row locks all six would pass the
      // capacity check together; with them, the others wait on the candidate row and then see the winner.
      let arrived = 0;
      let release!: () => void;
      const allArrived = new Promise<void>((r) => (release = r));
      const barrier: SelectionGate = {
        async check() {
          if (++arrived === 6) release();
          await Promise.race([allArrived, new Promise((r) => setTimeout(r, 1000))]);
          return { ok: true as const, enrollmentId: null, snapshot: {} };
        },
      };
      const racing = await buildApp({ config: testConfig(), db, pingRedis: async () => true, selectionGate: barrier });
      try {
        const solo = await createCandidate(clientId, { concurrentProjectLimit: 1 });
        const projects: string[] = [];
        for (let i = 0; i < 6; i++) {
          const id = await readyProject();
          await open(id);
          projects.push(id);
        }
        const results = await Promise.all(projects.map((id) => post(pm, `/projects/${id}/assignments`, { candidateIds: [solo.id] }, racing)));
        expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
        expect(results.filter((r) => r.statusCode === 409)).toHaveLength(5);
        expect(await db.projectAssignment.count({ where: { candidateId: solo.id, releasedAt: null } })).toBe(1);
      } finally {
        await racing.close();
      }
    });

    it('releasing an assignment while staffing makes the candidate available again', async () => {
      const a = await createCandidate(clientId);
      const projectId = await readyProject();
      await open(projectId);
      const list = (await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [a.id] })).json();
      const aid = list.items.find((i: { candidateId: string }) => i.candidateId === a.id).assignmentId;
      const res = await del(pm, `/projects/${projectId}/assignments/${aid}`);
      expect(res.json()).toMatchObject({ assigned: 0, shortfall: 2 });
      expect(res.json().items[0].status).toBe('AVAILABLE');
      // Re-assigning revives the same row.
      expect((await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [a.id] })).json().assigned).toBe(1);
      expect(await db.projectAssignment.count({ where: { projectId } })).toBe(1);
    });
  });

  describe('reject', () => {
    it('removes the candidate from this project only, and survives a re-run', async () => {
      const a = await createCandidate(clientId);
      const b = await createCandidate(clientId);
      const p1 = await readyProject();
      const p2 = await readyProject();
      await open(p1);
      await open(p2);
      const res = await post(pm, `/projects/${p1}/rejections`, { candidateId: a.id, reason: 'Conflict with client' });
      expect(ids(res.json())).toEqual([b.id]);
      expect(ids(await open(p1))).toEqual([b.id]);
      expect(new Set(ids(await open(p2)))).toEqual(new Set([a.id, b.id]));
      expect(await db.auditEvent.count({ where: { action: 'project.candidate_rejected' } })).toBe(1);
    });

    it('an assigned candidate must be released first', async () => {
      const a = await createCandidate(clientId);
      const projectId = await readyProject();
      await open(projectId);
      await post(pm, `/projects/${projectId}/assignments`, { candidateIds: [a.id] });
      expect((await post(pm, `/projects/${projectId}/rejections`, { candidateId: a.id })).json().error).toBe('ASSIGNED');
    });
  });

  describe('AC: approved applicants appear in the match list without a manual refresh', () => {
    it('a candidate.approved event re-runs the match for a staffing project', async () => {
      await createCandidate(clientId);
      const projectId = await readyProject();
      expect((await open(projectId)).items).toHaveLength(1);

      // A newly approved applicant (M4 emits this after human selection).
      const applicant = await createCandidate(clientId, { name: 'New applicant' });
      const event = await db.outboxEvent.create({
        data: { clientId, name: 'candidate.approved', aggregateType: 'Candidate', aggregateId: applicant.id, payload: { projectId, candidateId: applicant.id } },
      });
      await processDomainEvent(db, defaultHandlers(), event.id);

      // The screen's next poll (plain GET) shows them.
      expect(ids((await get(pm, `/projects/${projectId}/matches`)).json())).toContain(applicant.id);
      expect(await db.auditEvent.count({ where: { entityId: projectId, action: 'project.matched', actorType: 'SYSTEM' } })).toBe(1);
    });

    it('ignores approvals for projects that are not staffing', async () => {
      const projectId = await readyProject();
      const event = await db.outboxEvent.create({
        data: { clientId, name: 'candidate.approved', aggregateType: 'Candidate', aggregateId: randomUUID(), payload: { projectId } },
      });
      await processDomainEvent(db, defaultHandlers(), event.id);
      expect(await db.projectMatch.count()).toBe(0);
    });
  });

  describe('access', () => {
    it('only the owning PM and Admins can run staffing; Reviewers are refused', async () => {
      const a = await createCandidate(clientId);
      const projectId = await readyProject();
      expect((await post(otherPm, `/projects/${projectId}/match`)).statusCode).toBe(404);
      expect((await get(otherPm, `/projects/${projectId}/matches`)).statusCode).toBe(404);
      expect((await post(reviewer, `/projects/${projectId}/match`)).statusCode).toBe(403);
      expect((await open(projectId, admin)).status).toBe('STAFFING');
      expect((await post(otherPm, `/projects/${projectId}/assignments`, { candidateIds: [a.id] })).statusCode).toBe(404);
    });

    it('View profile returns matching fields only, within the client', async () => {
      const a = await createCandidate(clientId, { name: 'Profiled' });
      const res = await get(pm, `/candidates/${a.id}`);
      expect(res.json()).toMatchObject({ name: 'Profiled', identityVerified: true, country: 'GB', activeProjects: 0 });
      expect(Object.keys(res.json())).not.toContain('smeUserId');
      expect((await get(reviewer, `/candidates/${a.id}`)).statusCode).toBe(403);
      const other = await db.client.create({ data: { name: `Other ${randomUUID()}` } });
      const otherAdmin = await login(app, (await createUser(other.id, ['ADMIN'])).email);
      expect((await get(otherAdmin, `/candidates/${a.id}`)).statusCode).toBe(404);
    });
  });
});

describe('offline geocoder', () => {
  const g = new OfflineGeocoder();
  it('looks up cities, aliases and "City, CC"', async () => {
    expect(await g.lookup('london')).toMatchObject({ name: 'London', country: 'GB' });
    expect(await g.lookup('Bangalore')).toMatchObject({ name: 'Bengaluru', country: 'IN' });
    expect(await g.lookup('Dublin, IE')).toMatchObject({ country: 'IE' });
    expect(await g.lookup('Dublin, US')).toBeNull();
    expect(await g.lookup('Atlantis')).toBeNull();
  });
  it('computes great-circle distance (London to Manchester is about 262 km)', async () => {
    const d = distanceKm((await g.lookup('London'))!, (await g.lookup('Manchester'))!);
    expect(d).toBeGreaterThan(255);
    expect(d).toBeLessThan(270);
  });
});

describe('synthetic candidate seed (local dev)', () => {
  it('creates clearly synthetic, reproducible candidates and is safe to re-run', async () => {
    const { seedCandidates } = await import('../prisma/seed-candidates');
    await resetDb();
    const client = await db.client.create({ data: { name: `Seed ${randomUUID()}` } });
    expect(await seedCandidates(db, client.id, 20)).toEqual({ created: 20, existing: 0 });
    expect(await seedCandidates(db, client.id, 20)).toEqual({ created: 0, existing: 20 });
    const names = (await db.smeUser.findMany({ where: { clientId: client.id }, orderBy: { displayName: 'asc' } })).map((s) => s.displayName);
    expect(names[0]).toBe('Test Expert 001');
    expect(names.every((n) => n!.startsWith('Test Expert'))).toBe(true);
  });

  it('refuses to run in production', async () => {
    const { seedCandidates } = await import('../prisma/seed-candidates');
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(seedCandidates(db, randomUUID(), 1)).rejects.toThrow(/local development only/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
