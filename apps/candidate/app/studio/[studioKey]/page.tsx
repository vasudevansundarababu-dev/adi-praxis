import { pageTitle } from '@praxis/shared/theme';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { StudioClosed } from '@/components/studio/studio-closed';
import { StudioWorkbench } from '@/components/studio/studio-workbench';
import { getMe } from '@/lib/api';
import { studioServer } from '@/lib/studio/server';

export const metadata: Metadata = { title: { absolute: pageTitle('SME Studio') } };

async function studioUrl(key: string): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');
  return `${host ? `${proto}://${host}` : ''}/studio/${key}`;
}

/** Screen 4 (PRD §5.4): the SME studio at its preserved URL. Only the deployment's SME gets past the API (S4-02). */
export default async function StudioPage({ params }: { params: Promise<{ studioKey: string }> }) {
  const { studioKey } = await params;
  const me = await getMe();
  if (!me) redirect(`/sign-in?returnTo=${encodeURIComponent(`/studio/${studioKey}`)}`);
  const { status, data } = await studioServer.config(studioKey);
  if (status === 404 || status === 403) notFound();
  if (status === 410) return <main className="px-4"><StudioClosed workflowName={null} status="STOPPED" /></main>;
  if (!data) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-2xl font-semibold">This studio cannot open right now</h1>
        <p role="alert" className="mt-2 text-fg-muted">
          {status === 409 ? 'There is no task for you here at the moment: you may be at your limit for this project, or onboarding is not finished.' : `Something went wrong (${status}). Try again in a moment.`}
        </p>
      </main>
    );
  }
  if (data.deploymentStatus !== 'ACTIVE') return <main className="px-4"><StudioClosed workflowName={data.workflowName} status={data.deploymentStatus} /></main>;
  const tasks = (await studioServer.tasks(studioKey)).data?.items ?? [];
  return (
    <main className="mx-auto max-w-[100rem] px-4 py-6">
      <StudioWorkbench key={data.taskInstanceId} config={data} studioUrl={await studioUrl(studioKey)} smeLabel={me.displayName ?? me.contactEmail ?? 'You'} tasks={tasks} />
    </main>
  );
}
