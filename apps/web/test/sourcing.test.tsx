import { sourcedPersonFormProblems, type RecruiterPackDto, type SourcedPersonDto, type SourcingImportResult, type SourcingProjectDto } from '@praxis/shared';
import { describe, expect, it, vi } from 'vitest';
import { RecruiterPackPreview } from '../components/projects/recruiter-pack';
import { ImportPreview, ImportSheet } from '../components/sourcing/import-sheet';
import { fileProblems, NewPersonForm, projectsForRole } from '../components/sourcing/new-person-form';
import { filterSourced, SourcingList } from '../components/sourcing/sourcing-list';
import { activeGroup, navGroupsFor } from '../lib/nav';
import { a11yProblems } from './a11y';
import { html, text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const person = (o: Partial<SourcedPersonDto>): SourcedPersonDto => ({
  id: id(),
  projectId: id(),
  projectName: 'KYC-Of US bank Chicago',
  projectSkills: ['KYC', 'Sanctions screening'],
  role: 'SME',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@gmail.test',
  linkedinUrl: null,
  hasCv: false,
  hasAssessment: false,
  agency: null,
  submittedBy: 'Pat PM',
  createdAt: '2026-11-15T10:00:00.000Z',
  assigned: false,
  ...o,
});

const PEOPLE = [
  person({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@gmail.test' }),
  person({ firstName: 'Alan', lastName: 'Turing', email: 'alan@gmail.test', projectName: 'AML pilot', projectSkills: ['AML'] }),
  person({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@gmail.test', role: 'REVIEWER' }),
];

const PROJECTS: SourcingProjectDto[] = [
  { id: id(), name: 'AML pilot', status: 'STAFFING', reviewRoute: 'SME_PM', skills: ['AML'] },
  { id: id(), name: 'KYC-Of US bank Chicago', status: 'IN_PROGRESS', reviewRoute: 'SME_EXPERT_PM', skills: ['KYC', 'Sanctions screening'] },
];

describe('Sourcing list (owner, 15 Nov)', () => {
  it('shows the chosen tab; a search term matches name, email, role, skills or project across both roles', () => {
    expect(filterSourced(PEOPLE, 'SME', '').map((p) => p.firstName)).toEqual(['Ada', 'Alan']);
    expect(filterSourced(PEOPLE, 'REVIEWER', '').map((p) => p.firstName)).toEqual(['Grace']);
    expect(filterSourced(PEOPLE, 'SME', 'grace').map((p) => p.firstName)).toEqual(['Grace']);
    expect(filterSourced(PEOPLE, 'REVIEWER', 'ada lovelace').map((p) => p.firstName)).toEqual(['Ada']);
    expect(filterSourced(PEOPLE, 'SME', 'reviewer').map((p) => p.firstName)).toEqual(['Grace']);
    expect(filterSourced(PEOPLE, 'SME', 'sanctions').map((p) => p.firstName)).toEqual(['Ada', 'Grace']);
    expect(filterSourced(PEOPLE, 'SME', 'aml pilot').map((p) => p.firstName)).toEqual(['Alan']);
    expect(filterSourced(PEOPLE, 'SME', 'ALAN@GMAIL').map((p) => p.firstName)).toEqual(['Alan']);
    expect(filterSourced(PEOPLE, 'SME', '   ').map((p) => p.firstName)).toEqual(['Ada', 'Alan']);
  });

  it('renders the tabs, search, New and the agreed columns', () => {
    const m = html(<SourcingList items={PEOPLE} />);
    const t = text(m);
    expect(t).toContain('SMEs');
    expect(t).toContain('Reviewers');
    expect(m).toContain('role="search"');
    expect(m).toContain('href="/sourcing/new"');
    expect(t).toContain('First name Last name Email Role Project Skills (from the project) Submitted by Date');
    expect(t).toContain('Ada Lovelace ada@gmail.test SME KYC-Of US bank Chicago KYC, Sanctions screening Pat PM 15 Nov 2026');
    expect(t).not.toContain('Grace');
    expect(a11yProblems(m)).toEqual([]);
  });

  it('on the Reviewers tab, New opens the Reviewer form', () => {
    const m = html(<SourcingList items={PEOPLE} initialTab="REVIEWER" />);
    expect(m).toContain('href="/sourcing/new?role=REVIEWER"');
    expect(text(m)).toContain('Grace Hopper');
    expect(text(m)).toContain('Reviewers can be added only to projects whose review route has a Reviewer step.');
  });

  it('with a search term, says how many results across SMEs and Reviewers', () => {
    const t = text(html(<SourcingList items={PEOPLE} initialQuery="KYC" />));
    expect(t).toContain('2 results across SMEs and Reviewers');
    expect(t).toContain('Ada');
    expect(t).toContain('Grace');
    expect(text(html(<SourcingList items={PEOPLE} initialQuery="nobody" />))).toContain('0 results across SMEs and Reviewers');
  });

  it('is a top-level menu item after Projects, for Admins and PMs only', () => {
    const groups = navGroupsFor(['PM'], false);
    expect(groups.map((g) => g.label).slice(0, 3)).toEqual(['Home', 'Projects', 'Sourcing']);
    expect(activeGroup(groups, '/sourcing/new')?.key).toBe('sourcing');
    expect(navGroupsFor(['REVIEWER'], false).some((g) => g.key === 'sourcing')).toBe(false);
    expect(navGroupsFor(['ADMIN'], false).some((g) => g.key === 'sourcing')).toBe(true);
  });
});

describe('Sourcing → New', () => {
  const empty = { projectId: '', firstName: '', lastName: '', email: '', linkedinUrl: '' };

  it('requires project, first name, last name and a valid email; LinkedIn must be a web address', () => {
    expect(Object.keys(sourcedPersonFormProblems(empty)).sort()).toEqual(['email', 'firstName', 'lastName', 'projectId']);
    const ok = { projectId: PROJECTS[0]!.id, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@gmail.com', linkedinUrl: '' };
    expect(sourcedPersonFormProblems(ok)).toEqual({});
    expect(sourcedPersonFormProblems({ ...ok, email: 'ada at gmail' })).toEqual({ email: 'Enter a valid email address.' });
    expect(sourcedPersonFormProblems({ ...ok, firstName: '   ' })).toEqual({ firstName: 'Enter the first name.' });
    expect(sourcedPersonFormProblems({ ...ok, linkedinUrl: 'linkedin.com/in/ada' })).toEqual({ linkedinUrl: 'Enter a full web address starting with https://' });
    expect(sourcedPersonFormProblems({ ...ok, linkedinUrl: 'https://www.linkedin.com/in/ada' })).toEqual({});
  });

  it('accepts a PDF profile and an Excel or PDF assessment, up to 10 MB', () => {
    expect(fileProblems(null, null)).toEqual({});
    expect(fileProblems({ name: 'cv.pdf', size: 1000 }, { name: 'a.xlsx', size: 1000 })).toEqual({});
    expect(fileProblems({ name: 'cv.docx', size: 1000 }, { name: 'a.csv', size: 1000 })).toEqual({ cv: 'Upload the profile as a PDF.', assessment: 'Upload the assessment as Excel (.xlsx) or PDF.' });
    expect(fileProblems({ name: 'cv.pdf', size: 11 * 1024 * 1024 }, null)).toEqual({ cv: 'The profile is larger than 10 MB.' });
  });

  it('lists every open project for SMEs, and only Reviewer-route projects for Reviewers', () => {
    expect(projectsForRole(PROJECTS, 'SME').map((p) => p.name)).toEqual(['AML pilot', 'KYC-Of US bank Chicago']);
    expect(projectsForRole(PROJECTS, 'REVIEWER').map((p) => p.name)).toEqual(['KYC-Of US bank Chicago']);
    const m = html(<NewPersonForm projects={PROJECTS} role="REVIEWER" />);
    expect(m).not.toContain('AML pilot');
    expect(m).toContain('KYC-Of US bank Chicago');
  });

  it('renders the agreed fields with labels, the selected project skills and the sheet link', () => {
    const m = html(<NewPersonForm projects={PROJECTS} role="SME" initialProjectId={PROJECTS[1]!.id} />);
    const t = text(m).replace(/&#x27;/g, "'");
    for (const l of ['Project', 'First name', 'Last name', 'Email', 'LinkedIn URL', 'Profile (PDF, up to 10 MB)', "Candidate assessment (the recruiter's filled-in sheet: Excel, or PDF)"]) expect(t).toContain(l);
    expect(t).toContain('Skills: KYC, Sanctions screening');
    expect(t).toContain('Upload');
    expect(t).toContain('Cancel');
    expect(m).toContain(`href="/sourcing/import?role=SME&amp;project=${PROJECTS[1]!.id}"`);
    expect(a11yProblems(m)).toEqual([]);
  });
});

describe('assessment sheet import', () => {
  it('previews each row as OK or with its problems', () => {
    const result: SourcingImportResult = {
      projectId: PROJECTS[0]!.id,
      role: 'SME',
      dryRun: true,
      valid: 1,
      created: 0,
      skipped: 2,
      rows: [
        { row: 2, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@gmail.test', ok: true, problems: [] },
        { row: 3, firstName: 'Bad', lastName: 'Email', email: 'nope', ok: false, problems: ['Email is not a valid address.'] },
      ],
    };
    const t = text(html(<ImportPreview result={result} />));
    expect(t).toContain('2 Ada Lovelace ada@gmail.test OK');
    expect(t).toContain('3 Bad Email nope Email is not a valid address.');
  });

  it('starts with the project picker and the file picker', () => {
    const m = html(<ImportSheet projects={PROJECTS} role="REVIEWER" />);
    expect(text(m)).toContain('Check the sheet');
    expect(m).not.toContain('AML pilot');
    expect(a11yProblems(m)).toEqual([]);
  });
});

describe('Export to Recruiter preview', () => {
  const pack: RecruiterPackDto = {
    projectId: PROJECTS[1]!.id,
    projectName: 'KYC-Of US bank Chicago',
    date: '15 Nov 2026',
    fileName: 'candidate-assessment-KYC-Of-US-bank-Chicago.xlsx',
    role: { title: 'KYC task author', work: 'Write synthetic KYC cases.', location: 'Remote, United States', language: 'English', pay: '50 USD per accepted task', effort: 'About 60 minutes per task', peopleNeeded: 2 },
    requirements: [{ kind: 'Skill', detail: 'KYC', level: 'Required', evidence: 'Roles where they used this skill, with examples' }],
    cheatSheetIntro: 'Each expert writes one or more tasks in a fixed form, using made-up people and data only:',
    cheatSheet: [{ section: 'S1', title: 'Assignment and brief', explanation: 'The case in one line.' }],
    questions: [{ n: 1, text: 'Which processes?', required: true }],
    sendBack: [{ item: 'Why they fit', detail: 'A few sentences in your words.' }],
    sheetColumns: ['First name*'],
  };

  it('shows the four sections, both downloads through the API proxy, and the attachment note', () => {
    const m = html(<RecruiterPackPreview pack={pack} />);
    const t = text(m);
    for (const h of ['1 · The role', '2 · Requirements', '3 · The task they would author (SME cheat sheet)', '4 · What to send back for each candidate']) expect(t).toContain(h);
    expect(m).toContain(`href="/api/v1/projects/${pack.projectId}/recruiter-pack.pdf"`);
    expect(m).toContain(`href="/api/v1/projects/${pack.projectId}/recruiter-pack.xlsx"`);
    expect(t).toContain('Download PDF');
    expect(t).toContain('Download Excel only');
    expect(t).toContain('Attachment: candidate-assessment-KYC-Of-US-bank-Chicago.xlsx');
    expect(t).toContain('Some PDF viewers (for example Chrome and email previews) hide attachments.');
    expect(a11yProblems(m)).toEqual([]);
  });
});
