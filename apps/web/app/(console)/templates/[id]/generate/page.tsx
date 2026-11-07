import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pipeline } from '@/components/templates/deploy/pipeline';
import { McHeader } from '@/components/templates/mc-header';
import { getCurrentUser } from '@/lib/api';
import { mcServer } from '@/lib/mc/server';

export const metadata: Metadata = { title: 'Generate, verify and deploy' };

const UUID = /^[0-9a-f-]{36}$/i;

/** Screen 3 (PRD §5.3). Admin only: PMs never see it (S1-15). `?run=` and `?ver=` resume a pipeline after a reload. */
export default async function GeneratePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string; ver?: string }> }) {
  const [{ id }, { run, ver }, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  if (!user?.roles.includes('ADMIN')) notFound();
  const [{ data: t }, { data: bp }] = await Promise.all([mcServer.template(id), mcServer.blueprint(id)]);
  if (!t || !bp) notFound();
  const ready = bp.validSections === 6;
  const [models, targets, deployments, gen, v] = await Promise.all([
    mcServer.models(),
    mcServer.deploymentTargets(id),
    mcServer.deployments(id),
    run && UUID.test(run) ? mcServer.generation(run) : Promise.resolve({ data: null }),
    ver && UUID.test(ver) ? mcServer.verification(ver) : Promise.resolve({ data: null }),
  ]);
  const generation = gen.data?.templateId === t.id ? gen.data : null;
  const verification = generation && v.data?.generationRunId === generation.id ? v.data : null;

  return (
    <div>
      <McHeader isAdmin active={{ workflowName: t.workflowName, version: t.version, href: `/templates/${t.id}` }} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Generate, verify and deploy</h1>
        <span className="text-fg-muted">
          {t.workflowName} v{t.version}
        </span>
        <span className={`pill ${ready ? 'pill-success' : 'pill-warning'}`}>{bp.validSections}/6 Valid</span>
        <Link href={`/templates/${t.id}`} className="ml-auto text-sm text-link hover:underline">
          ← Back to the Meta-Compiler
        </Link>
      </div>
      {!ready ? (
        <p role="alert" className="mt-6 rounded-md border border-warning p-3 text-sm">
          Every section of the blueprint must be valid and saved before generating. Fix the remaining sections in the Meta-Compiler.
        </p>
      ) : (
        <div className="mt-4">
          <Pipeline
            templateId={t.id}
            models={models.data ?? { items: [], liveAi: false, codegenEnabled: false }}
            targets={targets.data?.projects ?? []}
            deployments={deployments.data?.items ?? []}
            initialGeneration={generation}
            initialVerification={verification}
          />
        </div>
      )}
    </div>
  );
}
