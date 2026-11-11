import type { ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PolicyWorkspace, type DocumentsData, type ExtractionData, type PreviewData, type RuleRow } from '@/components/policy/policy-workspace';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Policy rules' };

export default async function ProjectPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await apiGet<ProjectDto>(`/projects/${id}`);
  if (!project) notFound();
  const [docs, extraction, rules, preview, user] = await Promise.all([
    apiGet<DocumentsData>(`/projects/${id}/policy/documents`),
    apiGet<ExtractionData>(`/projects/${id}/policy/extraction`),
    apiGet<{ items: RuleRow[] }>(`/projects/${id}/policy/rules`),
    apiGet<PreviewData>(`/projects/${id}/policy/rule-set/preview`),
    getCurrentUser(),
  ]);
  return (
    <div>
      <Link href={`/projects/${id}`} className="text-sm text-link hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Policy rules</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        Add the project’s policy documents, extract candidate rules, review each rule against its source, then publish one rule set. Every task in this project inherits the published set. Extraction suggests; only a person marks a rule Reviewed.
      </p>
      <p className="mt-2 text-sm">
        <Link href="/review/policy-proposals" className="text-link hover:underline">Documents proposed by SMEs</Link> appear here once an Expert or you accept them.
      </p>
      <PolicyWorkspace
        projectId={id}
        isAdmin={user?.roles.includes('ADMIN') ?? false}
        documents={docs.data ?? { maxPages: 20, items: [] }}
        extraction={extraction.data}
        rules={rules.data?.items ?? []}
        preview={preview.data}
      />
    </div>
  );
}
