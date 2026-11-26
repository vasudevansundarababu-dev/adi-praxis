import type { ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FocusOnLoad } from '@/components/policy/focus-on-load';
import { LibraryDetailsEditor } from '@/components/policy/library-details';
import { RuleDetail, type RuleDetailData } from '@/components/policy/rule-detail';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'Policy rule' };

/** Rule page (PRD PR-M07): opened from the rule name in the Policy rules table. */
export default async function PolicyRulePage({ params }: { params: Promise<{ id: string; ruleId: string }> }) {
  const { id, ruleId } = await params;
  const [{ data: project }, { data: rule }] = await Promise.all([apiGet<ProjectDto>(`/projects/${id}`), apiGet<RuleDetailData>(`/projects/${id}/policy/rules/${ruleId}`)]);
  if (!project || !rule) notFound();
  return (
    <div>
      <Link href={`/projects/${id}/policy`} className="text-sm text-link hover:underline">
        ← Policy rules — {project.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{rule.body.title}</h1>
      <p className="font-mono text-sm text-fg-muted">{rule.ruleKey}</p>
      <RuleDetail projectId={id} d={rule} />
      <LibraryDetailsEditor projectId={id} ruleId={rule.ruleId} contentHash={rule.contentHash} body={rule.body} approved={rule.state === 'REVIEWED'} />
      <FocusOnLoad />
    </div>
  );
}
