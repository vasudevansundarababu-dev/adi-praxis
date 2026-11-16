import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AssignScreen } from '@/components/forge/assign-screen';
import {
  assignBody,
  assignButtons,
  assignOptions,
  criteriaLine,
  personKey,
  placesFullNote,
  requiredWorkersProblem,
  type AssignableData,
  type AssignablePerson,
} from '@/lib/forge-console';
import { a11yProblems } from './a11y';
import { text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const PID = '00000000-0000-4000-8000-0000000000aa';
const T = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;

const sourced: AssignablePerson = {
  source: 'SOURCING',
  sourcedPersonId: '00000000-0000-4000-8000-000000000401',
  candidateId: null,
  firstName: 'Casey',
  lastName: 'Nguyen',
  email: 'casey@gmail.test',
  role: 'SME',
  assessed: true,
  matchingSkills: [{ skill: 'KYC', matched: true }],
  location: null,
  experience: null,
  activeProjects: null,
  projectLimit: null,
  reviewableTaskIds: [],
};
const pooled: AssignablePerson = {
  source: 'POOL',
  sourcedPersonId: null,
  candidateId: '00000000-0000-4000-8000-000000000501',
  firstName: 'Ada',
  lastName: 'Fit',
  email: 'ada@gmail.test',
  role: null,
  assessed: true,
  matchingSkills: [
    { skill: 'KYC', matched: true },
    { skill: 'Sanctions screening', matched: false },
  ],
  location: { value: 'US', matched: true },
  experience: { value: null, matched: null },
  activeProjects: 1,
  projectLimit: 2,
  reviewableTaskIds: [T(3)],
};

const DATA: AssignableData = {
  reviewRoute: 'SME_PM',
  requiredWorkers: 4,
  taskCount: 4,
  minRequiredWorkers: 4,
  smePlacesUsed: 1,
  smePlacesFull: false,
  projectSkills: ['KYC', 'Sanctions screening'],
  criteria: { countries: ['US'], countryRequired: true, minYears: 3, yearsRequired: true },
  openTasks: [
    { taskId: T(4), label: 'Task 4', status: 'CREATED' },
    { taskId: T(5), label: 'Task 5', status: 'CREATED' },
  ],
  reviewableTasks: [{ taskId: T(3), label: 'Task 3', status: 'IN_PROGRESS' }],
  people: [sourced, pooled],
};

describe('D19: SME places on the Assign screen', () => {
  it('says why places are full and how to change it', () => {
    expect(placesFullNote(DATA)).toBeNull();
    expect(placesFullNote({ ...DATA, smePlacesFull: true, smePlacesUsed: 4 })).toBe(
      'All 4 SME places are filled (4 of 4 assigned). Required workers sets how many SMEs this project can have: raise it here to assign another SME.',
    );
  });

  it('checks the new Required workers before sending: a whole number, never below the floor', () => {
    expect(requiredWorkersProblem('', 4)).toBe('Enter a whole number.');
    expect(requiredWorkersProblem('4.5', 4)).toBe('Enter a whole number.');
    expect(requiredWorkersProblem('3', 4)).toMatch(/can't be lower than 4/);
    expect(requiredWorkersProblem('20000', 4)).toBe('Enter 10,000 or fewer.');
    expect(requiredWorkersProblem('6', 4)).toBeNull();
  });

  it('renders the places line with the task count and a labelled Required workers field; the full note when full', () => {
    const m = renderToStaticMarkup(<AssignScreen projectId={PID} projectName="KYC Project for US Bank" data={DATA} codes={{}} />);
    const t = text(m);
    expect(t).toContain('SME places: 1 of 4 used · 4 tasks.');
    expect(m).toContain('for="required-workers"');
    expect(m).toContain('min="4"');
    expect(t).toContain('At least 4: one place per task.');
    expect(t).not.toContain('All 4 SME places are filled');
    expect(a11yProblems(m)).toEqual([]);

    const full = renderToStaticMarkup(<AssignScreen projectId={PID} projectName="P" data={{ ...DATA, smePlacesUsed: 4, smePlacesFull: true }} codes={{}} />);
    expect(text(full)).toContain('All 4 SME places are filled (4 of 4 assigned).');
    expect(text(full)).toContain('SME places full: raise Required workers above');
    expect(full).not.toContain('>Assign as SME<');
  });
});

describe('D20: platform pool people on the Assign screen', () => {
  it('gives a pool person both roles where the route has a Reviewer step, and sends candidateId and role', () => {
    expect(assignButtons(DATA, pooled)).toEqual({ sme: true, smeFull: false, reviewer: false });
    expect(assignButtons({ ...DATA, reviewRoute: 'SME_EXPERT_PM' }, pooled)).toEqual({ sme: true, smeFull: false, reviewer: true });
    expect(assignOptions({ ...DATA, reviewRoute: 'SME_EXPERT_PM' }, pooled).map((g) => [g.label, g.tasks.map((x) => x.taskId)])).toEqual([
      ['To author (SME)', [T(4), T(5)]],
      ['To review (Reviewer)', [T(3)]],
    ]);
    expect(assignBody(pooled, 'REVIEWER', T(3))).toEqual({ candidateId: pooled.candidateId, role: 'REVIEWER', taskId: T(3) });
    // A Sourcing profile is sent as before.
    expect(assignBody(sourced, 'SME', T(4))).toEqual({ sourcedPersonId: sourced.sourcedPersonId, taskId: T(4) });
    expect(personKey(sourced)).toBe(sourced.sourcedPersonId);
    expect(personKey(pooled)).toBe(`pool:${pooled.candidateId}`);
  });

  it('shows the match against the criteria for pool people only', () => {
    expect(criteriaLine(pooled)).toEqual(['Location US ✓', 'Experience not stated', 'On 1 of 2 projects']);
    expect(criteriaLine({ ...pooled, location: { value: 'GB', matched: false }, experience: { value: 6, matched: true } })).toEqual(['Location GB ✗', 'Experience 6 yrs ✓', 'On 1 of 2 projects']);
    expect(criteriaLine(sourced)).toEqual([]);
  });

  it('lists both kinds of people, labels the pool, and names the criteria', () => {
    const m = renderToStaticMarkup(<AssignScreen projectId={PID} projectName="KYC Project for US Bank" data={DATA} codes={{ [T(4)]: 'TSK-004' }} />);
    const t = text(m);
    expect(t).toContain('Sourcing profiles, and available people from the platform pool who match its criteria (location US, 3+ years&#x27; domain experience).');
    expect(m).toContain(`data-person="${sourced.sourcedPersonId}"`);
    expect(m).toContain(`data-person="pool:${pooled.candidateId}"`);
    expect(m).toContain('data-source="POOL"');
    expect(t).toContain('Ada Fit ada@gmail.test KYC Platform pool Location US ✓ · Experience not stated · On 1 of 2 projects');
    expect(m.match(/>Assign as SME</g)).toHaveLength(2);
    expect(a11yProblems(m)).toEqual([]);
    expect(t).not.toMatch(/Praxis|Anvil|ADI-Labs/);
  });
});
