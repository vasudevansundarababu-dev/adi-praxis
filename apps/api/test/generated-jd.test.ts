import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildTestApp, createUser, db, idem, login, resetDb } from './helpers';

/** Owner bug, 12 Nov 2026: the JD is generated from the template's skills plus the project's demographics and education. */
const TEMPLATE = {
  primaryWork: 'Assemble identity evidence.',
  verificationCriteria: 'Document checks.',
  humanGate: 'Approval remains with a human.',
  defaultTptMinutes: 90,
  skills: ['KYC', 'EDD', 'Sanctions screening'],
  taskModes: ['AUTHORING', 'ANNOTATION'],
  edgeCaseCatalog: [{ name: 'PEP link', quota: 1, required: true }],
};
const FILTERS = [
  { attributeKey: 'country', operator: 'IN', values: ['GB', 'IE'], required: true },
  { attributeKey: 'languages', operator: 'IN', values: [{ language: 'en', minLevel: 'C1' }], required: true },
  { attributeKey: 'domain_experience_years', operator: 'GTE', values: { min: 4 }, required: false },
  { attributeKey: 'education_level', operator: 'IN', values: ['ISCED_7', 'ISCED_6', 'ISCED_8'], required: true },
];
const complete = { description: 'Q4 KYC authoring', startDate: '2026-10-05', endDate: '2026-12-18', distinctTarget: 50, maxPerExpert: 4, tptMinutes: 90, demographicFilters: FILTERS };

describe('Generated job descriptions (template skills, demographics, education; reviewer JD)', () => {
  let app: FastifyInstance;
  let admin: string;
  let pm: string;
  let templateId: string;
  let domainId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  beforeEach(async () => {
    await resetDb();
    const { client } = await seed(db, { SEED_CLIENT_NAME: 'ADI-Labs', SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(client.id, ['PM'])).email);
    domainId = (await post(admin, '/domains', { name: 'Banking' })).json().id;
    templateId = (await post(admin, '/templates', { domainId, workflowName: 'KYC onboarding and refresh', ...TEMPLATE })).json().id;
    expect((await post(admin, `/templates/${templateId}/publish`)).statusCode).toBe(200);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  const post = (cookie: string, url: string, payload: unknown = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  const patch = (cookie: string, url: string, payload: unknown) => app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: { cookie, ...idem() }, payload: payload as object });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie } });
  async function draft(extra: object = {}) {
    const res = await post(pm, '/projects', { authoringExperience: 'BOTH', templateId, name: `KYC ${randomUUID().slice(0, 6)}`, ...complete, ...extra });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }
  const jds = async (id: string) => (await get(pm, `/projects/${id}/job-descriptions`)).json();
  const setPay = async (jdId: string) => expect((await patch(pm, `/job-descriptions/${jdId}`, { wagePerTask: 40, wageCurrency: 'GBP' })).statusCode).toBe(200);

  it('creating a project generates the author JD: template skills mandatory, experience, education and demographics', async () => {
    const p = await draft();
    expect(p.jdGenerated).toBe(true);
    const { author, reviewer } = await jds(p.id);
    expect(p.jobDescriptionId).toBe(author.id);
    expect(reviewer).toBeNull();
    expect(author).toMatchObject({
      role: 'AUTHOR',
      generated: true,
      projectId: p.id,
      mandatorySkills: TEMPLATE.skills,
      skills: TEMPLATE.skills,
      minExperienceYears: 4,
      // The lowest level the project accepts.
      educationLevel: 'ISCED_6',
      wagePerTask: 0,
    });
    expect(author.title).toContain('KYC onboarding and refresh');
    expect(author.responsibilities).toMatch(/synthetic/);
    expect(author.demographicProfile.map((l: { key: string }) => l.key)).toEqual(['country', 'languages']);
    expect(author.demographicProfile[0]).toMatchObject({ label: 'Country / region', required: true });
    expect(author.demographicProfile[0].text).toMatch(/United Kingdom/);
    expect(await db.auditEvent.count({ where: { entityId: author.id, action: 'job_description.generated' } })).toBe(1);
    // Generated JDs belong to the project; the reusable list does not show them.
    expect((await get(pm, '/job-descriptions')).json().items.map((j: { id: string }) => j.id)).not.toContain(author.id);
  });

  it('the Expert route adds a reviewer JD with the same skills and more years of experience', async () => {
    const p = await draft({ reviewRoute: 'SME_EXPERT_PM' });
    const { author, reviewer } = await jds(p.id);
    expect(p.reviewerJobDescriptionId).toBe(reviewer.id);
    expect(reviewer).toMatchObject({ role: 'REVIEWER', mandatorySkills: TEMPLATE.skills, minExperienceYears: 9, educationLevel: 'ISCED_6' });
    expect(reviewer.title).toMatch(/expert reviewer/);
    expect(reviewer.demographicProfile).toEqual(author.demographicProfile);
    // Switching the route back drops the reviewer JD from the project.
    const back = (await patch(pm, `/projects/${p.id}`, { reviewRoute: 'SME_PM' })).json();
    expect(back.reviewerJobDescriptionId).toBeNull();
  });

  it('requirements follow later edits; PM edits to title and pay are kept; defaults apply without filters', async () => {
    const p = await draft({ demographicFilters: [FILTERS[0]] });
    let { author } = await jds(p.id);
    expect(author).toMatchObject({ minExperienceYears: 5, educationLevel: 'ISCED_6' });
    expect((await patch(pm, `/job-descriptions/${author.id}`, { title: 'Senior KYC author', wagePerTask: 55, wageCurrency: 'GBP', skills: [...TEMPLATE.skills, 'Python'] })).statusCode).toBe(200);
    expect((await patch(pm, `/projects/${p.id}`, { demographicFilters: FILTERS })).statusCode).toBe(200);
    ({ author } = await jds(p.id));
    expect(author).toMatchObject({ title: 'Senior KYC author', wagePerTask: 55, minExperienceYears: 4, skills: [...TEMPLATE.skills, 'Python'] });
    expect(await db.auditEvent.count({ where: { entityId: author.id, action: 'job_description.regenerated' } })).toBe(1);
  });

  it('the template’s mandatory skills cannot be removed (API and database)', async () => {
    const p = await draft();
    const { author } = await jds(p.id);
    const res = await patch(pm, `/job-descriptions/${author.id}`, { skills: ['KYC'] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('MANDATORY_SKILLS_REQUIRED');
    await expect(db.jobDescription.update({ where: { id: author.id }, data: { skills: ['KYC'] } })).rejects.toThrow(/mandatory_skills_kept/);
  });

  it('submit needs pay on each JD, then snapshots both; recruitment criteria come from the JD', async () => {
    const p = await draft({ reviewRoute: 'SME_EXPERT_PM' });
    const blocked = await post(pm, `/projects/${p.id}/submit`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().details.problems).toEqual(expect.arrayContaining(['Set the wage per task on the job description', 'Set the wage per task on the reviewer job description']));
    const { author, reviewer } = await jds(p.id);
    await setPay(author.id);
    await setPay(reviewer.id);
    const res = await post(pm, `/projects/${p.id}/submit`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().jdSnapshot).toMatchObject({ mandatorySkills: TEMPLATE.skills, minExperienceYears: 4 });
    expect(res.json().reviewerJdSnapshot).toMatchObject({ role: 'REVIEWER', minExperienceYears: 9 });

    const opp = (await get(pm, `/projects/${p.id}/opportunity`)).json();
    const required = opp.draft.criteria.filter((c: { kind: string }) => c.kind === 'REQUIRED').map((c: { text: string }) => c.text);
    expect(required).toEqual(
      expect.arrayContaining([
        'Hands-on experience with KYC',
        'Hands-on experience with EDD',
        'Hands-on experience with Sanctions screening',
        'At least 4 years of experience in the domain',
        "Education: Bachelor's or equivalent or higher (or equivalent professional experience)",
      ]),
    );
  });

  it('a hand-picked JD still has to carry the template skills, and the Expert route still gets a reviewer JD', async () => {
    const own = (await post(pm, '/job-descriptions', { title: 'KYC author', responsibilities: 'Write cases.', skills: ['KYC'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = await draft({ jobDescriptionId: own.id, reviewRoute: 'SME_EXPERT_PM' });
    expect(p).toMatchObject({ jdGenerated: false, jobDescriptionId: own.id });
    const { reviewer } = await jds(p.id);
    expect(reviewer).toMatchObject({ role: 'REVIEWER', wagePerTask: 40, minExperienceYears: 9 });
    const res = await post(pm, `/projects/${p.id}/submit`);
    expect(res.statusCode).toBe(422);
    expect(res.json().details.problems).toContain("The job description is missing the template's mandatory skills: EDD, Sanctions screening");
  });
});
