import type { Metadata } from 'next';
import { pageTitle } from '@praxis/shared/theme';
import { notFound, redirect } from 'next/navigation';
import { TaskPage } from '@/components/work/task-page';
import { TaskAids } from '@/components/forge/task-aids';
import { PolicyProposals } from '@/components/work/policy-proposals';
import { SendNeed } from '@/components/work/send-need';
import { TaskRules, type TaskRulesView } from '@/components/work/task-rules';
import { api, getForgeSettings, getMe } from '@/lib/api';
import type { ForgeHomeDto } from '@praxis/shared';
import type { TaskView } from '@/lib/work-types';

export const metadata: Metadata = { title: { absolute: pageTitle('Task') } };

export default async function TaskRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getMe())) redirect(`/sign-in?returnTo=${encodeURIComponent(`/tasks/${id}`)}`);
  const [{ data }, { data: policy }] = await Promise.all([api<TaskView>(`/me/tasks/${id}`), api<TaskRulesView>(`/me/tasks/${id}/policy`)]);
  if (!data) notFound();
  // MVP1 flow: the contributor terms come before any work (the API's gate answers step 'terms').
  let newFlow = false;
  if ((await getForgeSettings()).newFlow) {
    const { data: forge } = await api<ForgeHomeDto>('/me/forge/home');
    newFlow = !!forge?.newFlow && forge.authorTasks.some((t) => t.taskId === id);
    if (newFlow && !forge!.termsAccepted) redirect('/welcome');
  }
  return (
    // D17: room at the end so the floating Help mascot never covers the last content (or the rubric table).
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-36">
      {/* MVP1 step 7: the task's Tutorial and task-scoped Help replace the general floating Support Bot here. */}
      <TaskAids taskId={data.id} kind="author" tutorial={data.tutorial ?? null} />
      {policy && <TaskRules policy={policy} />}
      {data.taskType === 'AUTHORING' && <PolicyProposals taskId={data.id} readOnly={data.readOnly} />}
      {/* New RL Gym part 4: the only author-screen addition, a collapsed card beside the policy proposals. */}
      {data.taskType === 'AUTHORING' && <SendNeed taskId={data.id} readOnly={data.readOnly} />}
      <TaskPage task={data} newFlow={newFlow} />
    </main>
  );
}
