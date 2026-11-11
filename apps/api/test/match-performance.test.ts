import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { OfflineGeocoder } from '../src/staffing/geocoder';
import { RuleBasedMatchService } from '../src/staffing/match-service';
import { matchRequestFor } from '../src/staffing/staffing-service';
import { buildTestApp, createUser, db, idem, login, resetDb } from './helpers';

const POOL = 50_000;

/** SPEC non-functional: match query under 2 s for 50,000 candidates. */
describe(`match performance (${POOL.toLocaleString()} candidates)`, () => {
  let app: FastifyInstance;
  let projectId: string;
  let pm: string;

  beforeAll(async () => {
    await resetDb();
    app = await buildTestApp();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@perf.test', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    const admin = await login(app, 'admin@perf.test', 'admin-password-123');
    pm = await login(app, (await createUser(client.id, ['PM'])).email);
    const post = (cookie: string, url: string, payload: object = {}) =>
      app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload });

    const domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const templateId = (
      await post(admin, '/templates', {
        domainId, workflowName: 'KYC', primaryWork: 'x', verificationCriteria: 'x', humanGate: 'x', defaultTptMinutes: 60, skills: ['KYC', 'EDD'], taskModes: ['AUTHORING'],
      })
    ).json().id;
    await post(admin, `/templates/${templateId}/publish`);
    const jdId = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'x', skills: ['KYC', 'EDD', 'AML'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json().id;
    projectId = (
      await post(pm, '/projects', { authoringExperience: 'BOTH',
        templateId, name: 'Perf', distinctTarget: 50, maxPerExpert: 4, tptMinutes: 60, startDate: '2026-10-05', endDate: '2026-12-18', jobDescriptionId: jdId,
        demographicFilters: [
          { attributeKey: 'country', operator: 'IN', values: ['GB', 'IE', 'IN', 'US'], required: true },
          { attributeKey: 'languages', operator: 'IN', values: [{ language: 'en', minLevel: 'B2' }], required: true },
          { attributeKey: 'city_radius', operator: 'WITHIN_RADIUS', values: { city: 'London', radiusKm: 400 }, required: false },
          { attributeKey: 'domain_experience_years', operator: 'GTE', values: { min: 5 }, required: false },
        ],
      })
    ).json().id;
    expect((await post(pm, `/projects/${projectId}/submit`)).statusCode).toBe(200);

    // A varied synthetic pool: mixed countries, specialties, levels, identity states.
    const countries = ['GB', 'IE', 'IN', 'US', 'SG', 'DE'];
    const cities: [string, number, number][] = [['London', 51.5074, -0.1278], ['Dublin', 53.3498, -6.2603], ['Mumbai', 19.076, 72.8777], ['New York', 40.7128, -74.006], ['Singapore', 1.3521, 103.8198], ['Berlin', 52.52, 13.405]];
    const levels = ['B1', 'B2', 'C1', 'C2', 'NATIVE'];
    const specialties = [['KYC'], ['EDD'], ['AML'], ['Sanctions'], ['KYC', 'EDD']];
    for (let start = 0; start < POOL; start += 5000) {
      const smes = Array.from({ length: 5000 }, (_, k) => {
        const i = start + k;
        return { id: randomUUID(), clientId: client.id, displayName: `Perf Expert ${i}`, accountStatus: 'ACTIVE' as const, identityStatus: i % 10 === 0 ? ('PROCESSING' as const) : ('VERIFIED' as const) };
      });
      await db.smeUser.createMany({ data: smes });
      await db.candidate.createMany({
        data: smes.map((s, k) => {
          const i = start + k;
          const [city, lat, lng] = cities[i % cities.length]!;
          return {
            clientId: client.id, smeUserId: s.id, country: countries[i % countries.length]!, city, latitude: lat, longitude: lng,
            languages: [{ language: 'en', level: levels[i % levels.length]! }], specialties: specialties[i % specialties.length]!, skills: ['KYC', 'AML', 'EDD'].slice(0, 1 + (i % 3)),
            domainExperienceYears: i % 20, hoursPerWeek: 5 + (i % 35), timezone: 'Europe/London',
          };
        }),
      });
    }
    await db.$executeRawUnsafe('ANALYZE "Candidate"');
    await db.$executeRawUnsafe('ANALYZE "SmeUser"');
  }, 180_000);

  afterAll(async () => {
    await resetDb();
    await app.close();
    await db.$disconnect();
  });

  it('MatchService.findMatches runs in under 2 s', async () => {
    const matcher = new RuleBasedMatchService(db, new OfflineGeocoder());
    const req = await matchRequestFor(db, projectId);
    await matcher.findMatches(req); // warm-up (query plans, JIT)
    const t0 = performance.now();
    const run = await matcher.findMatches(req);
    const ms = performance.now() - t0;
    console.log(`findMatches over ${POOL} candidates: ${ms.toFixed(0)} ms, ${run.matches.length} matched`);
    expect(run.matches.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(2000);
  });

  it('opening the Resource Assignment screen (match + store top 500) also stays under 2 s', async () => {
    const t0 = performance.now();
    const res = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/match`, headers: { cookie: pm, ...idem() }, payload: {} });
    const ms = performance.now() - t0;
    console.log(`POST /match end to end: ${ms.toFixed(0)} ms`);
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(500);
    expect(ms).toBeLessThan(2000);
  });
});
