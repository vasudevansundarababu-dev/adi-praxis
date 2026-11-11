import { describe, expect, it } from 'vitest';
import { ReviewerApplicants } from '../components/opportunity/reviewer-applicants';
import { html, text } from './helpers';

const base = { name: 'Dana Expert', email: 'dana@example.test', identityVerified: true, expertUserId: null };

describe('reviewer job post applicants (owner, 12 Nov 2026)', () => {
  it('only a selected applicant with a verified identity can be made Expert', () => {
    const markup = html(
      <ReviewerApplicants
        projectId="00000000-0000-4000-8000-000000000001"
        initial={[
          { ...base, enrollmentId: '00000000-0000-4000-8000-000000000011', status: 'SELECTED' },
          { ...base, enrollmentId: '00000000-0000-4000-8000-000000000012', status: 'REVIEW_PENDING' },
          { ...base, enrollmentId: '00000000-0000-4000-8000-000000000013', status: 'SELECTED', identityVerified: false },
          { ...base, enrollmentId: '00000000-0000-4000-8000-000000000014', status: 'SELECTED', expertUserId: '00000000-0000-4000-8000-000000000099' },
        ]}
      />,
    );
    expect(markup.match(/Make Expert/g)).toHaveLength(1);
    expect(text(markup)).toContain('review pending');
    expect(text(markup)).toContain('not verified');
    expect(text(markup)).toContain('Expert on this project');
  });

  it('says so when nobody has applied', () => {
    expect(text(html(<ReviewerApplicants projectId="00000000-0000-4000-8000-000000000001" initial={[]} />))).toContain('No reviewer applications yet.');
  });
});
