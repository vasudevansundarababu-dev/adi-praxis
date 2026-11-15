import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, PDFHexString } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed';
import { buildApp } from '../src/app';
import { MockGoogleVerifier } from '../src/candidate/google';
import { MockIdentityProvider } from '../src/candidate/identity-provider';
import { MemoryStorage } from '../src/candidate/storage';
import { publicText, readAssessmentSheet } from '../src/forge/recruiter-pack';
import { MemoryEmailSender } from '../src/lib/email';
import { HashingEmbeddingProvider } from '../src/tasks/embeddings';
import { call } from './forge-helpers';
import { createUser, db, idem, login, resetDb, testConfig } from './helpers';

const SECRET = 'test-mock-secret';
const BANNED = /Praxis|Anvil|ADI[- ]?Labs/;

describe('MVP1 step 5: Sourcing screens and Export to Recruiter', () => {
  let app: FastifyInstance;
  const storage = new MemoryStorage();
  const google = new MockGoogleVerifier(SECRET);
  let clientId: string;
  let admin: string;
  let pm: string;
  let otherPm: string;

  const post = (cookie: string, url: string, payload: object = {}) => call(app, 'POST', cookie, url, payload);
  const get = (cookie: string, url: string) => call(app, 'GET', cookie, url);

  beforeAll(async () => {
    app = await buildApp({
      db,
      pingRedis: async () => true,
      google,
      identity: new MockIdentityProvider(SECRET, 'http://candidate.test'),
      resolveClientId: async () => clientId,
      storage,
      email: new MemoryEmailSender(),
      embeddings: new HashingEmbeddingProvider(),
      config: testConfig(),
    });
  });

  beforeEach(async () => {
    await resetDb();
    storage.objects.clear();
    const { client } = await seed(db, { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'admin-password-123', TASKFLOW_PATH: '/none' });
    clientId = client.id;
    admin = await login(app, 'admin@test.local', 'admin-password-123');
    pm = await login(app, (await createUser(clientId, ['PM'])).email);
    otherPm = await login(app, (await createUser(clientId, ['PM'])).email);
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function template() {
    const domainId = (await db.domain.findFirst({ where: { clientId } }))?.id ?? (await post(admin, '/domains', { name: 'Banking' })).json().id;
    const t = (
      await post(admin, '/templates', {
        domainId,
        workflowName: `KYC ${randomUUID().slice(0, 6)}`,
        primaryWork: 'Assemble identity evidence and recommend a disposition.',
        verificationCriteria: 'Document checks, completeness, policy adherence.',
        humanGate: 'Approval, rejection and high-risk classification remain human decisions.',
        defaultTptMinutes: 60,
        skills: ['KYC'],
        taskModes: ['AUTHORING'],
        coverageDimensions: { dimensions: [{ key: 'customer_type', label: 'Customer type', values: ['individual', 'corporate'] }], cells: [] },
        edgeCaseCatalog: [],
      })
    ).json();
    expect((await post(admin, `/templates/${t.id}/publish`)).statusCode).toBe(200);
    return t.id as string;
  }

  /** A submitted authoring project owned by the PM (hand-picked JD: KYC, Sanctions screening; country GB required). */
  async function project(opts: { route?: 'SME_PM' | 'SME_EXPERT_PM'; submit?: boolean; name?: string } = {}) {
    const templateId = await template();
    const jd = (await post(pm, '/job-descriptions', { title: 'KYC Analyst', responsibilities: 'Author KYC cases for the Praxis platform.\n\nSecond paragraph.', skills: ['KYC', 'Sanctions screening'], wagePerTask: 40, wageCurrency: 'GBP', locationType: 'REMOTE' })).json();
    const p = (
      await post(pm, '/projects', {
        authoringExperience: 'BOTH',
        templateId,
        name: opts.name ?? `Forge ${randomUUID().slice(0, 6)}`,
        taskMode: 'AUTHORING',
        distinctTarget: 12,
        maxPerExpert: 4,
        tptMinutes: 60,
        startDate: '2026-10-05',
        endDate: '2026-10-06',
        jobDescriptionId: jd.id,
        demographicFilters: [{ attributeKey: 'country', operator: 'IN', values: ['GB'], required: true }],
      })
    ).json();
    expect(p.id, JSON.stringify(p)).toBeTruthy();
    if (opts.submit !== false) expect((await post(pm, `/projects/${p.id}/submit`)).statusCode).toBe(200);
    if (opts.route) await db.project.update({ where: { id: p.id }, data: { reviewRoute: opts.route } });
    return p.id as string;
  }

  /** A filled assessment sheet: the given header and rows. */
  async function sheet(header: string[], rows: (string | null)[][]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Candidates');
    ws.addRow(header);
    for (const r of rows) ws.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  function upload(cookie: string, fields: Record<string, string>, file: Buffer, dryRun: boolean) {
    const boundary = `----forge${randomUUID()}`;
    const parts = [
      ...Object.entries(fields).map(([k, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sheet.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ];
    return app.inject({ method: 'POST', url: `/api/v1/sourcing/people/import?dryRun=${dryRun ? 1 : 0}`, headers: { cookie, ...idem(), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(parts) });
  }

  /** The PDF's embedded files, by name. */
  function attachments(pdf: PDFDocument): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict);
    const ef = names.lookup(PDFName.of('EmbeddedFiles'), PDFDict);
    const arr = ef.lookup(PDFName.of('Names'), PDFArray);
    for (let i = 0; i < arr.size(); i += 2) {
      const name = arr.lookup(i) as PDFString | PDFHexString;
      const spec = arr.lookup(i + 1, PDFDict);
      const stream = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'), PDFRawStream);
      out.set(name.decodeText(), decodePDFRawStream(stream).decode());
    }
    return out;
  }

  describe('recruiter pack', () => {
    it('builds the four sections from the project, with no internal names', async () => {
      const pid = await project({ name: 'KYC-Of US bank Chicago' });
      const r = await get(pm, `/projects/${pid}/recruiter-pack`);
      expect(r.statusCode, r.body).toBe(200);
      const pack = r.json();
      expect(pack.fileName).toBe('candidate-assessment-KYC-Of-US-bank-Chicago.xlsx');
      expect(pack.role).toMatchObject({ title: 'KYC Analyst', pay: '40 GBP per accepted task', peopleNeeded: expect.any(Number) });
      expect(pack.role.work).toBe('Author KYC cases for the ADI Forge platform.');
      expect(pack.role.location).toMatch(/^Remote/);
      expect(pack.role.effort).toBe('About 60 minutes per task · up to 4 tasks per person');
      // Hand-picked JD: the first skill is required, the rest preferred; the country filter is a requirement too.
      expect(pack.requirements[0]).toMatchObject({ kind: 'Skill', detail: 'KYC', level: 'Required' });
      expect(pack.requirements[1]).toMatchObject({ kind: 'Skill', detail: 'Sanctions screening', level: 'Preferred' });
      expect(pack.requirements.some((x: { level: string; detail: string }) => x.level === 'Required' && /United Kingdom|GB/.test(x.detail))).toBe(true);
      expect(pack.requirements.every((x: { evidence: string }) => x.evidence.length > 0)).toBe(true);
      // The default question policy: six questions, the requirements one pointing at section 2.
      expect(pack.questions).toHaveLength(6);
      expect(pack.questions.map((q: { n: number }) => q.n)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(pack.questions.some((q: { text: string }) => q.text.includes('requirements in section 2'))).toBe(true);
      expect(pack.cheatSheet.map((s: { section: string }) => s.section)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
      expect(pack.sendBack.map((s: { item: string }) => s.item)).toEqual(['First name, last name, email', 'Assessment against the requirements', 'Why they fit', 'Answers to the questions', 'Optional']);
      expect(pack.sheetColumns.slice(0, 4)).toEqual(['First name*', 'Last name*', 'Email (Gmail)*', 'LinkedIn URL']);
      expect(pack.sheetColumns.slice(-3)).toEqual(['Why they fit', 'Recruiter name', 'Agency']);
      expect(pack.sheetColumns).toContain('Skill: KYC — Met? (Yes/No)');
      expect(pack.sheetColumns).toContain('Skill: KYC — Evidence');
      expect(pack.sheetColumns.filter((c: string) => /^Q\d+\. /.test(c))).toHaveLength(6);
      expect(JSON.stringify(pack)).not.toMatch(BANNED);
    });

    it('uses a generated JD: mandatory skills, experience and education are required, added skills preferred', async () => {
      const pid = await project();
      const p = await db.project.findUniqueOrThrow({ where: { id: pid }, include: { jdSnapshot: true } });
      const data = { ...(p.jdSnapshot!.data as object), skills: ['KYC', 'EDD'], mandatorySkills: ['KYC'], minExperienceYears: 7, educationLevel: 'ISCED_6', demographicProfile: [{ key: 'language', label: 'Language', text: 'English (C1 Advanced or above)', required: true }] };
      await db.jobDescriptionSnapshot.update({ where: { id: p.jdSnapshotId! }, data: { data } });
      const pack = (await get(pm, `/projects/${pid}/recruiter-pack`)).json();
      expect(pack.requirements.map((r: { kind: string; level: string }) => `${r.kind}:${r.level}`)).toEqual(['Skill:Required', 'Skill:Preferred', 'Experience:Required', 'Education:Required', 'Language:Required']);
      expect(pack.requirements[2].detail).toMatch(/^7\+ years in /);
      expect(pack.role.language).toBe('English (C1 Advanced or above)');
    });

    it('is for Admins and the owning PM only', async () => {
      const pid = await project();
      expect((await get(otherPm, `/projects/${pid}/recruiter-pack`)).statusCode).toBe(404);
      expect((await get(admin, `/projects/${pid}/recruiter-pack`)).statusCode).toBe(200);
      expect((await get(otherPm, `/projects/${pid}/recruiter-pack.xlsx`)).statusCode).toBe(404);
      expect((await get(otherPm, `/projects/${pid}/recruiter-pack.pdf`)).statusCode).toBe(404);
    });

    it('downloads the assessment sheet with the agreed columns, an Instructions sheet and Yes/No choices', async () => {
      const pid = await project({ name: 'KYC-Of US bank Chicago' });
      const pack = (await get(pm, `/projects/${pid}/recruiter-pack`)).json();
      const r = await get(pm, `/projects/${pid}/recruiter-pack.xlsx`);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toContain('spreadsheetml');
      expect(r.headers['content-disposition']).toBe('attachment; filename="candidate-assessment-KYC-Of-US-bank-Chicago.xlsx"');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(r.rawPayload as unknown as ExcelJS.Buffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Candidates', 'Instructions']);
      const ws = wb.getWorksheet('Candidates')!;
      const header = (ws.getRow(1).values as unknown[]).slice(1);
      expect(header).toEqual(pack.sheetColumns);
      const met = header.findIndex((h) => String(h).endsWith('Met? (Yes/No)')) + 1;
      expect(ws.getCell(2, met).dataValidation).toMatchObject({ type: 'list', formulae: ['"Yes,No"'] });
      const instructions = wb.getWorksheet('Instructions')!.getColumn(1).values.join('\n');
      expect(instructions).toContain('ADI Forge');
      expect(instructions).not.toMatch(BANNED);
    });

    it('downloads one PDF with the sheet attached inside it', async () => {
      const pid = await project({ name: 'KYC-Of US bank Chicago' });
      const r = await get(pm, `/projects/${pid}/recruiter-pack.pdf`);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect(r.headers['content-disposition']).toBe('attachment; filename="recruiter-pack-KYC-Of-US-bank-Chicago.pdf"');
      const pdf = await PDFDocument.load(r.rawPayload);
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
      expect(pdf.getTitle()).toMatch(/^ADI Forge — Recruiter pack · KYC-Of US bank Chicago · \d{1,2} \w{3} \d{4}$/);
      const files = attachments(pdf);
      expect([...files.keys()]).toEqual(['candidate-assessment-KYC-Of-US-bank-Chicago.xlsx']);
      const read = await readAssessmentSheet(Buffer.from(files.get('candidate-assessment-KYC-Of-US-bank-Chicago.xlsx')!));
      expect('error' in read).toBe(false);
      if (!('error' in read)) expect(read.headers.slice(0, 3)).toEqual(['First name*', 'Last name*', 'Email (Gmail)*']);
    });

    it('replaces internal names in free text', () => {
      expect(publicText('ADI Praxis by ADI-Labs, validated by Anvil; Praxis checks')).toBe('ADI Forge by ADI Forge, validated by RL Gym; ADI Forge checks');
    });
  });

  describe('assessment sheet import', () => {
    const HEADER = ['First name*', 'Last name*', 'Email (Gmail)*', 'LinkedIn URL', 'Skill: KYC — Met? (Yes/No)', 'Skill: KYC — Evidence', 'Q1. Which processes?', 'Why they fit', 'Recruiter name', 'Agency'];

    it('dry run reports each row; the real import creates the valid rows only, stores the sheet once and audits counts', async () => {
      const pid = await project();
      await post(pm, '/sourcing/people', { projectId: pid, role: 'SME', firstName: 'Old', lastName: 'Timer', email: 'old@gmail.test' });
      const file = await sheet(HEADER, [
        ['Ada', 'Lovelace', 'Ada@Gmail.test', 'https://linkedin.example/in/ada', 'Yes', '10 years retail KYC', 'KYC / onboarding', 'Strong fit', 'Rita Recruiter', 'Talent Co'],
        ['Alan', 'Turing', 'alan@gmail.test', null, 'No', null, null, null, null, null],
        ['', 'NoFirst', 'nofirst@gmail.test'],
        ['Bad', 'Email', 'not-an-email'],
        ['Ada', 'Again', 'ada@gmail.test'],
        ['Old', 'Timer', 'old@gmail.test'],
        [],
        ['Bad', 'Link', 'link@gmail.test', 'linkedin dot com'],
      ]);
      const dry = await upload(pm, { projectId: pid, role: 'SME' }, file, true);
      expect(dry.statusCode, dry.body).toBe(200);
      const d = dry.json();
      expect(d).toMatchObject({ dryRun: true, valid: 2, created: 0 });
      expect(d.rows.map((r: { row: number; ok: boolean }) => [r.row, r.ok])).toEqual([[2, true], [3, true], [4, false], [5, false], [6, false], [7, false], [9, false]]);
      expect(d.rows[2].problems).toEqual(['First name is required.']);
      expect(d.rows[3].problems).toEqual(['Email is not a valid address.']);
      expect(d.rows[4].problems).toEqual(['Repeated in this sheet (same email as row 2).']);
      expect(d.rows[5].problems).toEqual(['Already submitted to this project for this role.']);
      expect(d.rows[6].problems).toEqual(['LinkedIn URL is not a valid web address.']);
      expect(await db.sourcedPerson.count({ where: { projectId: pid } })).toBe(1);

      const real = await upload(pm, { projectId: pid, role: 'SME' }, file, false);
      expect(real.statusCode, real.body).toBe(200);
      expect(real.json()).toMatchObject({ dryRun: false, valid: 2, created: 2, skipped: 5 });
      const ada = await db.sourcedPerson.findFirstOrThrow({ where: { projectId: pid, emailNorm: 'ada@gmail.test' } });
      expect(ada).toMatchObject({ role: 'SME', firstName: 'Ada', lastName: 'Lovelace', linkedinUrl: 'https://linkedin.example/in/ada', agency: 'Talent Co' });
      expect(ada.assessment).toEqual({ 'Skill: KYC — Met? (Yes/No)': 'Yes', 'Skill: KYC — Evidence': '10 years retail KYC', 'Q1. Which processes?': 'KYC / onboarding', 'Why they fit': 'Strong fit', 'Recruiter name': 'Rita Recruiter' });
      const alan = await db.sourcedPerson.findFirstOrThrow({ where: { projectId: pid, emailNorm: 'alan@gmail.test' } });
      expect(ada.assessmentStorageKey).toBeTruthy();
      expect(alan.assessmentStorageKey).toBe(ada.assessmentStorageKey);
      expect(storage.objects.size).toBe(1);
      const [a] = await db.auditEvent.findMany({ where: { action: 'sourcing.people_imported' } });
      expect(a!.after).toMatchObject({ projectId: pid, role: 'SME', created: 2, skipped: 5 });
      expect(JSON.stringify(a)).not.toMatch(/ada|lovelace|alan|turing/i);
      expect(await db.auditEvent.count({ where: { action: 'sourcing.person_added' } })).toBe(3);
      // The people show in Sourcing with the project's skills.
      const list = (await get(pm, '/sourcing/people?role=SME')).json().items;
      expect(list.find((x: { email: string }) => x.email === 'ada@gmail.test')).toMatchObject({ hasAssessment: true, projectSkills: expect.arrayContaining(['KYC']) });

      // Importing the same sheet again creates nobody.
      const again = (await upload(pm, { projectId: pid, role: 'SME' }, file, false)).json();
      expect(again).toMatchObject({ created: 0 });
      expect(again.rows.filter((r: { problems: string[] }) => r.problems.includes('Already submitted to this project for this role.'))).toHaveLength(4);
    });

    it('applies the same rules as Sourcing → New: owning PM, open project, Reviewers only on the Reviewer route', async () => {
      const pid = await project();
      const file = await sheet(HEADER, [['Ada', 'Lovelace', 'ada@gmail.test']]);
      expect((await upload(otherPm, { projectId: pid, role: 'SME' }, file, true)).statusCode).toBe(404);
      expect((await upload(admin, { projectId: pid, role: 'SME' }, file, true)).statusCode).toBe(200);
      const rev = await upload(pm, { projectId: pid, role: 'REVIEWER' }, file, true);
      expect(rev.statusCode).toBe(409);
      expect(rev.json().error).toBe('NO_REVIEWER_STEP');
      const routed = await project({ route: 'SME_EXPERT_PM' });
      const ok = await upload(pm, { projectId: routed, role: 'REVIEWER' }, file, false);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(await db.sourcedPerson.count({ where: { projectId: routed, role: 'REVIEWER' } })).toBe(1);
      await db.project.update({ where: { id: pid }, data: { status: 'COMPLETED' } });
      expect((await upload(pm, { projectId: pid, role: 'SME' }, file, true)).json().error).toBe('PROJECT_NOT_OPEN');
    });

    it('refuses a file that is not the assessment sheet', async () => {
      const pid = await project();
      const wrong = await upload(pm, { projectId: pid, role: 'SME' }, await sheet(['Name', 'Mail'], [['A', 'a@gmail.test']]), true);
      expect(wrong.statusCode).toBe(422);
      expect(wrong.json().error).toBe('BAD_SHEET');
      const empty = await upload(pm, { projectId: pid, role: 'SME' }, await sheet(HEADER, []), true);
      expect(empty.json().error).toBe('BAD_SHEET');
      const pdf = await upload(pm, { projectId: pid, role: 'SME' }, Buffer.from('%PDF-1.4\n'), true);
      expect(pdf.statusCode).toBe(415);
      expect((await upload(pm, { role: 'SME' }, await sheet(HEADER, []), true)).statusCode).toBe(400);
    });
  });

  describe('projects for the New screen', () => {
    it('lists only new or active projects the caller may upload for, with route and skills', async () => {
      const open = await project({ name: 'B open' });
      const routed = await project({ name: 'A routed', route: 'SME_EXPERT_PM' });
      await project({ name: 'C draft', submit: false });
      const done = await project({ name: 'D done' });
      await db.project.update({ where: { id: done }, data: { status: 'CANCELLED' } });
      const r = await get(pm, '/sourcing/projects');
      expect(r.statusCode).toBe(200);
      const items = r.json().items;
      expect(items.map((x: { name: string }) => x.name)).toEqual(['A routed', 'B open']);
      expect(items[0]).toMatchObject({ id: routed, reviewRoute: 'SME_EXPERT_PM', skills: expect.arrayContaining(['KYC', 'Sanctions screening']) });
      expect(items[1]).toMatchObject({ id: open, reviewRoute: 'SME_PM' });
      expect((await get(otherPm, '/sourcing/projects')).json().items).toEqual([]);
      expect((await get(admin, '/sourcing/projects')).json().items).toHaveLength(2);
    });
  });
});
