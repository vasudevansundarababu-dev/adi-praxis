import { describe, expect, it, vi } from 'vitest';
import { ReviewerApplicants, type ReviewerApplicant } from '../components/opportunity/reviewer-applicants';
import { TaskTable, type TaskRow } from '../components/tasks/task-admin';
import { html, text } from './helpers';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const task = (n: number): TaskRow => ({
  id: id(n),
  status: 'IN_PROGRESS',
  taskType: 'AUTHORING',
  brief: `Brief number ${n}`,
  author: `Expert ${n}`,
  assignedAt: null,
  lastSavedAt: null,
  submittedAt: null,
  activeSeconds: 0,
  reworkCount: 0,
});

const applicant = (n: number): ReviewerApplicant => ({ enrollmentId: id(100 + n), name: `Applicant ${n}`, email: null, status: 'REVIEW_PENDING', identityVerified: false, expertUserId: null });

/** D24: operations tables show 10 rows per page with the shared pagination bar under them. */
describe('paged operations tables (D24)', () => {
  it('the project task table shows the first 10 of 23 tasks and the count', () => {
    const markup = html(<TaskTable projectId={id(1)} tptMinutes={45} initial={Array.from({ length: 23 }, (_, i) => task(i + 1))} />);
    expect(markup.match(/<tr>/g)?.length).toBe(1 + 10); // header row + one page
    const t = text(markup);
    expect(t).toContain('Showing 10 of 23 tasks');
    expect(t).toContain('Brief number 10');
    expect(t).not.toContain('Brief number 11');
    expect(markup).toContain('aria-label="Next page"');
    expect(markup).toContain('aria-label="Page 3"');
  });

  it('reviewer applicants: 12 applicants page to 10, a short list shows the count with no page buttons', () => {
    const many = text(html(<ReviewerApplicants projectId={id(1)} initial={Array.from({ length: 12 }, (_, i) => applicant(i + 1))} />));
    expect(many).toContain('Showing 10 of 12 applicants');
    expect(many).not.toContain('Applicant 11');

    const one = html(<ReviewerApplicants projectId={id(1)} initial={[applicant(1)]} />);
    expect(text(one)).toContain('Showing 1 of 1 applicant');
    expect(one).not.toContain('aria-label="Next page"');
  });
});
