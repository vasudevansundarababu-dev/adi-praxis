import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AssignScreen, AssignSearch } from '@/components/forge/assign-screen';
import type { AssignableData, AssignablePerson } from '@/lib/forge-console';
import { a11yProblems } from './a11y';
import { text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }) }));

const PID = '00000000-0000-4000-8000-0000000000aa';
const person = (n: number, over: Partial<AssignablePerson> = {}): AssignablePerson => ({
  source: 'SOURCING',
  sourcedPersonId: `00000000-0000-4000-8000-0000000004${String(n).padStart(2, '0')}`,
  candidateId: null,
  firstName: `First${n}`,
  lastName: `Last${n}`,
  email: `p${n}@gmail.test`,
  role: 'SME',
  assessed: true,
  matchingSkills: [{ skill: 'KYC', matched: true }],
  location: null,
  experience: null,
  activeProjects: null,
  projectLimit: null,
  reviewableTaskIds: [],
  ...over,
});
const DATA: AssignableData = {
  reviewRoute: 'SME_PM',
  requiredWorkers: 4,
  taskCount: 4,
  minRequiredWorkers: 4,
  smePlacesUsed: 0,
  smePlacesFull: false,
  projectSkills: ['KYC'],
  openTasks: [{ taskId: '00000000-0000-4000-8000-000000000104', label: 'Task 4', status: 'CREATED' }],
  reviewableTasks: [],
  people: Array.from({ length: 10 }, (_, i) => person(i + 1)),
  peopleAvailable: 25,
  page: 2,
  pageSize: 10,
  total: 25,
  pageCount: 3,
};

describe('D23: search on the Assign people screen', () => {
  it('puts a labelled search box above the list, by first name, last name, email or skill', () => {
    const m = renderToStaticMarkup(<AssignScreen projectId={PID} projectName="P" data={DATA} codes={{}} />);
    expect(m).toContain('role="search"');
    expect(m).toContain('Search people');
    expect(m).toContain('placeholder="Search by first name, last name, email or skill"');
    expect(m.indexOf('role="search"')).toBeLessThan(m.indexOf('<table'));
    // No clear button while the box is empty.
    expect(text(m)).not.toContain('Clear');
    expect(a11yProblems(m)).toEqual([]);
  });

  it('keeps the search from the URL in the box and offers a clear button', () => {
    const m = renderToStaticMarkup(<AssignSearch initialQuery="ada" />);
    expect(m).toContain('value="ada"');
    expect(text(m)).toContain('Clear');
  });

  it('says "no matches" when the search finds no one, not "no one available"', () => {
    const m = renderToStaticMarkup(<AssignScreen projectId={PID} projectName="P" data={{ ...DATA, people: [], total: 0, page: 1, pageCount: 1 }} codes={{}} query="zzz" />);
    const t = text(m);
    expect(t).toContain('No matches for “zzz”.');
    expect(t).not.toContain('No one available matches this project');
    // With no search, an empty list still says no one matches the project.
    const empty = renderToStaticMarkup(<AssignScreen projectId={PID} projectName="P" data={{ ...DATA, people: [], peopleAvailable: 0, total: 0 }} codes={{}} />);
    expect(text(empty)).toContain('No one available matches this project');
  });

  it('pages the people (D24): the filtered total, the current page in the URL and highlighted, and the search kept in the page links', () => {
    const m = renderToStaticMarkup(<AssignScreen projectId={PID} projectName="P" data={DATA} codes={{}} query="kyc" searchParams={{ q: 'kyc', page: '2' }} />);
    expect(text(m)).toContain('Showing 10 of 25 people');
    expect(m).toContain('aria-current="page"');
    expect(m).toMatch(/aria-current="page"[^>]*>2</);
    expect(m).toContain('href="?q=kyc&amp;page=3"');
    expect(m).toContain('href="?q=kyc"'); // page 1 drops ?page=
    expect(a11yProblems(m)).toEqual([]);
  });

  it('keeps a task already chosen in a row: the choice is held by the screen, not the row', () => {
    // Each row's select is controlled by the screen's choices, so a row that leaves the page (search or paging) and
    // comes back shows the same task. Rendered fresh, every select starts on "Choose a task…".
    const m = renderToStaticMarkup(<AssignScreen projectId={PID} projectName="P" data={DATA} codes={{}} />);
    expect(m.match(/<option value="" selected="">Choose a task…<\/option>/g)).toHaveLength(10);
  });
});
