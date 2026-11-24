import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ForgotPasswordForm, SetPasswordForm } from '@/components/forge/password-forms';
import { SignInForm } from '@/components/sign-in-form';
import { FORGOT_SENT, newPasswordProblem, ONLINE_NEW_HERE, signInVariant } from '@/lib/forge';
import { a11yProblems } from './a11y';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }) }));
vi.mock('next/script', () => ({ default: () => null }));

const text = (m: string) => m.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const BANNED = /Praxis|Anvil|ADI[- ]?Labs/;

describe('MVP1 step 6: sign-in form variant', () => {
  it('new flow Online is email and password; new flow Offline is the simulated form; new flow off is unchanged', () => {
    expect(signInVariant({ newFlow: true, candidateSignIn: 'ONLINE' })).toBe('password');
    expect(signInVariant({ newFlow: true, candidateSignIn: 'OFFLINE' })).toBe('offline');
    expect(signInVariant({ newFlow: false, candidateSignIn: 'ONLINE' })).toBe('classic');
    expect(signInVariant({ newFlow: false, candidateSignIn: 'OFFLINE' })).toBe('classic');
  });

  it('Online renders Email, Password, 18+, Forgot password and the new-here note', () => {
    const html = renderToStaticMarkup(<SignInForm returnTo="" googleClientId="" newFlow variant="password" />);
    const t = text(html);
    expect(html).toContain('type="password"');
    expect(html).toContain('href="/forgot-password"');
    expect(t).toContain('I confirm I am 18 or over.');
    expect(t).toContain(ONLINE_NEW_HERE);
    expect(t).not.toMatch(/Google/);
    expect(t).not.toMatch(BANNED);
    expect(a11yProblems(html)).toEqual([]);
  });

  it('Offline is labelled as the no-password test sign-in, with Email and Name', () => {
    const html = renderToStaticMarkup(<SignInForm returnTo="" googleClientId="" newFlow variant="offline" />);
    const t = text(html);
    expect(t).toContain('Offline sign-in (test environment): no password');
    expect(html).toContain('id="dev-email"');
    expect(html).toContain('id="dev-name"');
    expect(html).not.toContain('type="password"');
    expect(a11yProblems(html)).toEqual([]);
  });

  it('new flow off keeps the earlier dev sign-in', () => {
    const t = text(renderToStaticMarkup(<SignInForm returnTo="" googleClientId="" variant="classic" />));
    expect(t).toContain('Dev sign-in (mock Google)');
    expect(t).not.toContain('Offline sign-in');
  });
});

describe('MVP1 step 6: set and forgot password', () => {
  it('checks length, the email name and that both entries match', () => {
    expect(newPasswordProblem('', '')).toBe('Enter a new password.');
    expect(newPasswordProblem('short', 'short')).toBe('Use at least 12 characters.');
    expect(newPasswordProblem('grace.hopper-is-great', 'grace.hopper-is-great', 'grace.hopper@gmail.test')).toMatch(/email address/);
    expect(newPasswordProblem('a-long-enough-passphrase', 'a-long-enough-passphrasf')).toBe('The two passwords do not match.');
    expect(newPasswordProblem('a-long-enough-passphrase', 'a-long-enough-passphrase', 'grace@gmail.test')).toBeNull();
  });

  it('the pages are accessible and use public names only', () => {
    const set = renderToStaticMarkup(<SetPasswordForm token="abc" />);
    expect(text(set)).toContain('New password');
    expect(text(set)).toContain('Confirm new password');
    const forgot = renderToStaticMarkup(<ForgotPasswordForm />);
    expect(text(forgot)).toContain('Email');
    for (const h of [set, forgot]) {
      expect(a11yProblems(h)).toEqual([]);
      expect(text(h)).not.toMatch(BANNED);
    }
    expect(FORGOT_SENT).toBe("If that email has an account, we've sent a link.");
  });
});

describe('cut and paste in SME authoring (owner, 23 Nov 2026)', () => {
  it('is allowed in Offline sign-in mode and blocked in Online', async () => {
    const { blocksPaste } = await import('@/lib/forge');
    expect(blocksPaste('AUTHORING', { newFlow: true, candidateSignIn: 'OFFLINE' })).toBe(false);
    expect(blocksPaste('AUTHORING', { newFlow: true, candidateSignIn: 'ONLINE' })).toBe(true);
    // The settings could not be read (fallback): keep the block.
    expect(blocksPaste('AUTHORING', { newFlow: false, candidateSignIn: 'OFFLINE' })).toBe(true);
    expect(blocksPaste('ANNOTATION', { newFlow: true, candidateSignIn: 'ONLINE' })).toBe(false);
  });
});
