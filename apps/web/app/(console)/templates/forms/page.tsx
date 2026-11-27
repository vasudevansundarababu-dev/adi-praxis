import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GoldenPackUpload } from '@/components/templates/golden-pack-upload';
import { McHeader } from '@/components/templates/mc-header';
import { apiGet, getCurrentUser } from '@/lib/api';
import { UploadedForms, type UploadedForm } from './uploaded-forms';

export const metadata: Metadata = { title: 'Authoring forms' };

/** Authoring forms and golden task packs (owner, 12 Nov 2026). Admin only. Search and the pager (`?page=`) run in the browser (UI standard 3a). */
export default async function FormsPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.includes('ADMIN')) notFound();
  const forms = (await apiGet<{ items: UploadedForm[] }>('/template-profiles')).data?.items ?? [];
  const uploaded = forms.filter((f) => f.source === 'uploaded');
  return (
    <div>
      <McHeader isAdmin />
      <h1 className="mt-4 text-2xl font-semibold">Authoring forms and golden packs</h1>
      <p className="mt-1 text-sm text-fg-muted">
        An authoring form is what SMEs fill in for a workflow. Upload a golden task pack to add a form without a code change, then choose it on a template version. Execution,
        evaluation and reporting stay in RL Gym.
      </p>
      <GoldenPackUpload />
      <h2 className="mt-8 text-lg font-semibold">Uploaded forms</h2>
      {uploaded.length === 0 ? <p className="mt-2 text-sm text-fg-muted">No packs uploaded yet.</p> : <UploadedForms forms={uploaded} />}
      <p className="mt-6 text-sm text-fg-muted">{forms.length - uploaded.length} built-in forms are also available.</p>
    </div>
  );
}
