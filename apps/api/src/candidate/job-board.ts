import { AppError } from '../lib/errors';

export interface JobPost {
  title: string;
  summary: string;
  responsibilities: string;
  skills: string[];
  wagePerTask: number;
  wageCurrency: string;
  locationType: 'REMOTE' | 'ONSITE' | 'HYBRID';
  location: string | null;
  applyUrl: string;
}

export interface PublishedPost {
  externalId: string | null;
  postText: string;
  /** What the PM has to do, if anything. */
  instructions: string;
}

/** SPEC FLOW 2 sourcing: where job posts go. */
export interface JobBoardAdapter {
  readonly channel: 'LINKEDIN_MANUAL' | 'LINKEDIN_APPLY_CONNECT';
  publish(post: JobPost): Promise<PublishedPost>;
  close(externalId: string | null): Promise<void>;
}

const LOCATION_LABEL = { REMOTE: 'Remote', ONSITE: 'On-site', HYBRID: 'Hybrid' } as const;

/**
 * v1 (SPEC): the platform writes the post and a tracked apply link; the PM posts it on LinkedIn as a job with
 * "apply on company website". Wage and location are always shown (SPEC compliance).
 */
export class ManualAdapter implements JobBoardAdapter {
  readonly channel = 'LINKEDIN_MANUAL' as const;

  async publish(p: JobPost): Promise<PublishedPost> {
    const where = p.location ? `${LOCATION_LABEL[p.locationType]} (${p.location})` : LOCATION_LABEL[p.locationType];
    const postText = [
      p.title,
      '',
      p.summary,
      '',
      'What you will do',
      p.responsibilities,
      '',
      `Skills: ${p.skills.join(', ')}`,
      `Pay: ${p.wagePerTask} ${p.wageCurrency} per accepted task`,
      `Location: ${where}`,
      '',
      'This is contributor work on synthetic tasks, not an employment offer. Selected experts complete a short identity check and onboarding before any task.',
      '',
      `Apply: ${p.applyUrl}`,
    ].join('\n');
    return {
      externalId: null,
      postText,
      instructions:
        'Post this on LinkedIn as a job. Under "How candidates apply", choose "Apply on company website" and paste the apply link. Applicants are counted automatically.',
    };
  }

  async close(): Promise<void> {
    // Nothing to call: the PM closes the LinkedIn post manually.
  }
}

/**
 * Later, only if an Apply Connect partnership is approved (SPEC). LinkedIn's Job Posting API is closed to new
 * partners, so this adapter is a named stub and refuses to run.
 */
export class LinkedInApplyConnectAdapter implements JobBoardAdapter {
  readonly channel = 'LINKEDIN_APPLY_CONNECT' as const;
  async publish(): Promise<PublishedPost> {
    throw new AppError(501, 'CHANNEL_NOT_AVAILABLE', 'LinkedIn Apply Connect is not enabled. Use the manual LinkedIn post.');
  }
  async close(): Promise<void> {
    throw new AppError(501, 'CHANNEL_NOT_AVAILABLE', 'LinkedIn Apply Connect is not enabled.');
  }
}
