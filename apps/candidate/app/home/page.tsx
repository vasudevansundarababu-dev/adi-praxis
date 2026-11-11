import { identityEligible } from '@praxis/shared';
import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Assignments } from '@/components/journey/assignments';
import { SupportBot } from '@/components/support/support-bot';
import { Journey, NextStep, StatusPill } from '@/components/ui';
import { api, getMe } from '@/lib/api';
import type { AssignmentCard } from '@/lib/journey-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Home') } };

type Project = { projectId: string; name: string; status: string; counts: Record<string, number> };

/** C08 home: where the candidate is, the one next thing to do, then projects, applications and assignments. */
export default async function HomePage() {
  const me = await getMe();
  if (!me) redirect('/sign-in');
  const eligible = identityEligible(me.identityStatus);
  const { data: assignments } = await api<{ items: AssignmentCard[] }>('/me/assignments');
  const { data: projects } = await api<{ items: Project[] }>('/me/projects');
  const proposals = (assignments?.items ?? []).filter((a) => a.status === 'PROPOSED');
  const accepted = (assignments?.items ?? []).some((a) => a.status === 'ACCEPTED' || a.status === 'HANDED_OFF');
  const e = me.enrollments;
  const draft = e.find((x) => x.status === 'DRAFT');
  const needsInfo = e.find((x) => x.status === 'NEEDS_INFORMATION');
  const inReview = e.find((x) => ['SUBMITTED', 'REVIEW_PENDING', 'REVIEW_REQUESTED'].includes(x.status));
  const selected = e.find((x) => x.status === 'SELECTED');
  const openTasks = (projects?.items ?? []).reduce((n, p) => n + (p.counts.ASSIGNED ?? 0) + (p.counts.IN_PROGRESS ?? 0) + (p.counts.REWORK ?? 0), 0);

  // The single most useful next step, and the matching journey stage.
  let stage = 0;
  let next: { title: string; body?: string; href?: string; cta?: string };
  if (me.applicationBlockReason) next = { title: 'Contributors must be 18 or over', body: me.applicationBlockReason };
  else if (!eligible) next = { title: 'Verify your identity', body: 'A quick check protects the contributor community.', href: '/verify', cta: me.identityStatus === 'NOT_STARTED' ? 'Verify now' : 'Check status' };
  else if (openTasks > 0 && projects?.items[0]) {
    stage = 5;
    next = { title: `You have ${openTasks} open task${openTasks === 1 ? '' : 's'}`, body: 'Pick up where you left off; your work saves automatically.', href: `/projects/${projects.items[0].projectId}`, cta: 'Continue writing' };
  } else if (proposals.length) {
    stage = 4;
    next = { title: 'You have a new assignment proposal', body: 'Review the details below and accept or decline.', href: '#assignments', cta: 'See proposal' };
  } else if (accepted) {
    stage = 5;
    next = { title: 'Your assignment is accepted', body: 'Open the workbench from your assignment below.', href: '#assignments', cta: 'Open assignment' };
  } else if (selected) {
    stage = 3;
    next = { title: 'You were selected: complete onboarding', body: 'A short checklist, then you can receive assignments.', href: `/enrollments/${selected.id}/onboarding`, cta: 'Start onboarding' };
  } else if (needsInfo) {
    stage = 2;
    next = { title: 'The Validator asked for more information', href: `/enrollments/${needsInfo.id}/status`, cta: 'See what’s needed' };
  } else if (inReview) {
    stage = 2;
    next = { title: 'Your application is with a Validator', body: 'A person reviews every application. We’ll let you know when there’s a decision.', href: `/enrollments/${inReview.id}/status`, cta: 'View status' };
  } else if (draft) {
    stage = 1;
    next = { title: 'Finish your SME profile', body: 'A few quick questions, most of them one tap.', href: `/enrollments/${draft.id}`, cta: 'Continue profile' };
  } else {
    stage = 1;
    next = { title: 'Find an opportunity that fits your expertise', href: '/opportunities', cta: 'Browse opportunities' };
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <section className="hero p-6 sm:p-8">
        <p className="muted text-sm">{me.identityLabel}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Welcome{me.displayName ? `, ${me.displayName.split(' ')[0]}` : ''}</h1>
        <Journey current={stage} className="mt-5" />
        <NextStep {...next} />
      </section>

      {(projects?.items.length ?? 0) > 0 && (
        <section aria-labelledby="projects-h">
          <h2 id="projects-h" className="text-lg font-semibold">Your projects</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {projects!.items.map((p) => (
              <li key={p.projectId}>
                <Link href={`/projects/${p.projectId}`} className="card card-link block p-4">
                  <p className="font-semibold">{p.name}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="pill pill-info">{(p.counts.ASSIGNED ?? 0) + (p.counts.IN_PROGRESS ?? 0) + (p.counts.REWORK ?? 0)} open</span>
                    <span className="pill pill-warning">{p.counts.SUBMITTED ?? 0} in review</span>
                    <span className="pill pill-success">{p.counts.ACCEPTED ?? 0} accepted</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="apps-h">
        <div className="flex items-center justify-between gap-3">
          <h2 id="apps-h" className="text-lg font-semibold">Your applications</h2>
          <Link href="/opportunities" className="text-sm text-link hover:underline">Browse opportunities</Link>
        </div>
        {e.length === 0 ? (
          <p className="card mt-3 p-4 text-sm text-fg-muted">No applications yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {e.map((x) => (
              <li key={x.id}>
                <Link href={`/enrollments/${x.id}${x.status === 'DRAFT' ? '' : '/status'}`} className="card card-link flex flex-wrap items-center justify-between gap-3 p-4">
                  <span className="font-medium">{x.title}</span>
                  <StatusPill status={x.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(selected || (assignments?.items.length ?? 0) > 0) && (
        <div id="assignments">
          <Assignments initial={assignments?.items ?? []} onboarded={!!selected} />
        </div>
      )}
      <SupportBot />
    </main>
  );
}
