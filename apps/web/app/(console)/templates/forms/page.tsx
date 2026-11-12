import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GoldenPackUpload } from '@/components/templates/golden-pack-upload';
import { McHeader } from '@/components/templates/mc-header';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Authoring forms' };

interface Form {
  profileId: string;
  name: string;
  workflowName: string;
  source: 'builtin' | 'uploaded';
  isDefault: boolean;
  agentMode: 'SINGLE' | 'MULTI';
  examples: number;
  uploadedAt: string | null;
}

/** Authoring forms and golden task packs (owner, 12 Nov 2026). Admin only. */
export default async function FormsPage() {
  const user = (await getCurrentUser())!;
  if (!user.roles.includes('ADMIN')) notFound();
  const forms = (await apiGet<{ items: Form[] }>('/template-profiles')).data?.items ?? [];
  const uploaded = forms.filter((f) => f.source === 'uploaded');
  return (
    <div>
      <McHeader isAdmin />
      <h1 className="mt-4 text-2xl font-semibold">Authoring forms and golden packs</h1>
      <p className="mt-1 text-sm text-fg-muted">
        An authoring form is what SMEs fill in for a workflow. Upload a golden task pack to add a form without a code change, then choose it on a template version. Execution,
        evaluation and reporting stay in Anvil.
      </p>
      <GoldenPackUpload />
      <h2 className="mt-8 text-lg font-semibold">Uploaded forms</h2>
      {uploaded.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">No packs uploaded yet.</p>
      ) : (
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr>
              <th scope="col">Form</th>
              <th scope="col">Workflow</th>
              <th scope="col">Agents</th>
              <th scope="col">Golden cases</th>
              <th scope="col">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {uploaded.map((f) => (
              <tr key={f.profileId}>
                <td>
                  {f.name} <span className="text-fg-muted">({f.profileId})</span>
                </td>
                <td>{f.workflowName}</td>
                <td>{f.agentMode === 'MULTI' ? 'multi-agent' : 'single'}</td>
                <td>{f.examples}</td>
                <td>{f.uploadedAt?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-6 text-sm text-fg-muted">{forms.length - uploaded.length} built-in forms are also available.</p>
    </div>
  );
}
