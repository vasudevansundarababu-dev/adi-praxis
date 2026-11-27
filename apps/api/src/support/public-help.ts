import { tutorialsEnabled } from '@praxis/shared';

/**
 * D-109 and D-110 (owner, 27 Nov 2026: "D109 yes (for authoring)"): Help for the pages anyone can open without signing
 * in, plus the console's change-password page (the API refuses every other call there until the password is changed).
 * Static text from the help pack only: no Support Bot, no model call, no spend. It covers these public pages and nothing
 * else: no internal page help, no project data, no rule, task or user names. Simple business English, with an example
 * for each term.
 */
export interface PublicHelpTerm {
  term: string;
  meaning: string;
  example: string;
}
export interface PublicPageHelp {
  title: string;
  intro: string;
  terms: PublicHelpTerm[];
  /** What to do if something goes wrong. */
  stuck: string;
}
export type PublicHelpApp = 'sme' | 'console';

const t = (term: string, meaning: string, example: string): PublicHelpTerm => ({ term, meaning, example });

const SIGN_IN_STUCK = 'If you cannot sign in, check the email address for typing mistakes, then use "Forgot password?". If that does not help, contact the person who invited you (your recruitment agency or the program manager).';

const SME: Record<string, PublicPageHelp> = {
  welcome: {
    title: 'Welcome page',
    intro: 'This is the front page for experts. From here you can look at open work or sign in.',
    terms: [
      t('Subject-matter expert', 'A person with real working experience in an area, who writes and checks tasks in that area.', 'A KYC analyst with five years at a bank is a subject-matter expert for KYC tasks.'),
      t('Synthetic task', 'A realistic piece of work written with made-up details. It never uses real customers, employers or accounts.', 'A customer file for "Maria Lopez, born 1984" where Maria and her documents are invented.'),
      t('See opportunities', 'Opens the list of areas that are looking for experts now.', 'You click See opportunities and find "Banking: KYC reviews".'),
      t('Sign in', 'Opens the sign-in page. You need an account first, which comes from an invitation.', 'Your agency emails you an invitation; after you set a password, you sign in here.'),
    ],
    stuck: 'If the buttons do not open, refresh the page. If it still does not work, try again later.',
  },
  signIn: {
    title: 'Sign in',
    intro: 'Sign in with the email address you were invited with. After you sign in you see your home page and the tasks assigned to you.',
    terms: [
      t('Email address', 'The address your invitation was sent to. A different address will not find your account.', 'Your agency invited you at jane.doe@example.com, so you sign in with jane.doe@example.com, not your work address.'),
      t('Password', 'The password you chose from the link in your invitation email. It has at least 12 characters.', 'Three unrelated words such as "river lamp orbit" are easy to remember and hard to guess.'),
      t('Continue with Google', 'In some environments you sign in with your Google account instead of a password. We only ask Google who you are; we never read your Gmail, Drive or contacts.', 'You click Continue with Google and pick the Google account you were invited with.'),
      t('I confirm I am 18 or over', 'You must tick this box to continue. Only adults can work on tasks.', 'If you forget to tick it, the page asks you to tick it and continue again.'),
      t('Forgot password?', 'Opens a page that emails you a link to choose a new password.', 'You cannot remember your password, so you click Forgot password? and enter your email address.'),
      t('Test sign-in', 'Some test environments show a sign-in without a password. It is only for testing with made-up data and is never used for real work.', 'A tester signs in as a sample expert to check a screen.'),
    ],
    stuck: SIGN_IN_STUCK,
  },
  forgotPassword: {
    title: 'Forgot password',
    intro: 'Enter the email address you sign in with. We send a link to that address so you can choose a new password.',
    terms: [
      t('Email address', 'The address you sign in with.', 'jane.doe@example.com'),
      t('Reset link', 'A one-time link in an email from us. It opens a page where you choose a new password. It expires after 1 hour.', 'You open the email, click the link within the hour and choose your new password.'),
      t('"If that email has an account"', 'For your safety we show the same message whether or not the address has an account, so nobody can use this page to check who is registered.', 'You typed the wrong address: you still see the message, but no email arrives.'),
    ],
    stuck: 'If no email arrives within a few minutes, check your spam or junk folder, check the address for typing mistakes, and ask again. If it still does not arrive, contact the person who invited you.',
  },
  setPassword: {
    title: 'Set your password',
    intro: 'Choose the password you will use with your email address to sign in. You reach this page from the link in an invitation or a reset email.',
    terms: [
      t('New password', 'At least 12 characters. Do not use your email address or a password you use on other sites.', 'Three unrelated words such as "river lamp orbit".'),
      t('Confirm password', 'Type the same password again, so a typing mistake does not lock you out.', 'You type "river lamp orbit" in both boxes.'),
      t('One-time link', 'The link works once and for a limited time. After you set your password, sign in with your email address and the new password.', 'You used the link yesterday; today you sign in from the sign-in page instead.'),
    ],
    stuck: 'If the page says the link has expired or was already used, go to the sign-in page, click "Forgot password?" and ask for a new link.',
  },
  opportunities: {
    title: 'Opportunities',
    intro: 'The areas that are looking for experts now. Open one to see what the work is, what you need and what not to share.',
    terms: [
      t('Opportunity', 'An area of work that needs experts, with a short description of the tasks.', '"Banking: KYC reviews" asks for people who have checked customer identity documents at a bank.'),
      t('Synthetic task', 'A realistic piece of work written with made-up details. You never use real customer or employer data.', 'You write a case about an invented customer whose passport is about to expire.'),
      t('Apply', 'Starts a few short questions about your experience. A person decides who is selected; applying does not guarantee selection.', 'You answer questions about your years in KYC and the kinds of cases you handled.'),
      t('Closed', 'The opportunity no longer accepts new applications.', 'You see "This opportunity is closed to new applications" and look at another one.'),
      t('What not to share', 'Real names, account numbers, ID numbers or documents of real people, and anything confidential from your employer.', 'Write "a customer with a UK passport", never a real customer\'s name or passport number.'),
    ],
    stuck: 'If the list is empty, there is no open work right now. Check again later.',
  },
  tutorials: {
    title: 'Tutorials',
    intro: 'A short video and a guide that show how experts work, so you can see the steps before you start.',
    terms: [
      t('Video', 'An 8-minute walk-through with captions and no sound. It uses made-up data.', 'Watch it to see how a task is written and checked, from the invitation to payment set-up.'),
      t('Expert guide (PDF)', 'Every step of the expert journey, with the labels you will see on screen and what to do if something does not work.', 'Keep the guide open in another tab while you write your first task.'),
      t('Test environment', 'A copy of the site for testing. Sign-in, identity checks and payouts there are simulated.', 'In the test environment no real payment is made.'),
    ],
    stuck: 'If the video does not play, try another browser or open the guide instead.',
  },
  privacy: {
    title: 'Privacy notice',
    intro: 'How we use your personal information. The approved notice is published on this page before experts are invited.',
    terms: [
      t('Personal information', 'Information about you, such as your name, email address and work experience.', 'Your email address is personal information; the made-up customer in a task is not.'),
      t('Identity check', 'A check that you are who you say you are. We never store pictures of your ID or your ID number.', 'You show your ID to a verification service; we keep only the result, such as "verified".'),
    ],
    stuck: 'If you have a question about your information, contact the person who invited you.',
  },
  terms: {
    title: 'Contributor terms',
    intro: 'The rules for working as an expert. The approved terms are published on this page before experts are invited.',
    terms: [
      t('Contributor', 'A person who writes or checks tasks.', 'You become a contributor when you accept the terms and start your first task.'),
      t('Synthetic only', 'Every task uses made-up details. You agree never to add real customer or employer data.', 'You invent "Acme Trading Ltd" instead of naming a real company you worked with.'),
    ],
    stuck: 'If you have a question about the terms, contact the person who invited you.',
  },
};

const CONSOLE: Record<string, PublicPageHelp> = {
  login: {
    title: 'Sign in to Authoring',
    intro: 'For Admins, Program Managers and Validators. Sign in with the email address and password your administrator gave you.',
    terms: [
      t('Email address', 'The work address your administrator set up for you.', 'pm.jones@example.com'),
      t('Password', 'Your own password. The first time, you use a temporary password and are asked to choose your own.', 'Your administrator gives you a temporary password; after signing in you choose "river lamp orbit tide".'),
      t('Role', 'What you can do after signing in. Your administrator gives you your role.', 'A Program Manager runs projects and assigns people; a Validator reviews tasks.'),
      t('Request access or password help', 'Opens your email app with a request to the administrator. You must send the email yourself. Never put a password in it.', 'You forgot your password, so you send a request and the administrator sets a temporary one.'),
    ],
    stuck: 'After many attempts in a short time the page says "Too many attempts"; wait a minute and try again. If you still cannot sign in, use "Request access or password help".',
  },
  changePassword: {
    title: 'Change password',
    intro: 'Choose your own password. If you signed in with a temporary password, you must do this before you can use the console.',
    terms: [
      t('Current or temporary password', 'The password you just signed in with. For a first sign-in, that is the temporary password.', 'The temporary password from your administrator.'),
      t('New password', 'At least 12 characters. A few unrelated words are easy to remember and hard to guess. Do not use your email address or a password you use elsewhere.', '"river lamp orbit tide"'),
      t('Confirm new password', 'Type the new password again, so a typing mistake does not lock you out.', 'You type "river lamp orbit tide" in both boxes.'),
      t('Other sessions', 'When you save, you are signed out everywhere else, for example on another computer.', 'You change your password at work; your laptop at home asks you to sign in again.'),
    ],
    stuck: 'If the page says "Too many attempts", wait a minute and try again. If you have lost your temporary password, sign out and use "Request access or password help" on the sign-in page.',
  },
};

/** Which public page a path is, or null: only these pages have public help. */
export function publicHelpFor(app: PublicHelpApp, path: string): PublicPageHelp | null {
  const p = (path.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/';
  if (app === 'console') {
    if (p === '/login') return CONSOLE.login!;
    if (p === '/change-password') return CONSOLE.changePassword!;
    return null;
  }
  if (p === '/') return SME.welcome!;
  if (p === '/sign-in') return SME.signIn!;
  if (p === '/forgot-password') return SME.forgotPassword!;
  if (/^\/set-password\/[^/]+$/.test(p)) return SME.setPassword!;
  if (p === '/opportunities' || /^\/opportunities\/[^/]+$/.test(p)) return SME.opportunities!;
  if (p === '/tutorials') return tutorialsEnabled() ? SME.tutorials! : null;
  if (p === '/privacy') return SME.privacy!;
  if (p === '/terms') return SME.terms!;
  return null;
}

/** Every public page's help, for the plain-text checks. */
export const PUBLIC_PAGE_HELP = { sme: SME, console: CONSOLE } as const;
