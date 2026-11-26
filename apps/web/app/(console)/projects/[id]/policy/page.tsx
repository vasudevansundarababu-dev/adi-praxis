import type { ProjectDto } from '@praxis/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Documents, Extraction, PolicyWorkspace, Publish, type DocumentsData, type ExtractionData, type PreviewData, type RuleRow } from '@/components/policy/policy-workspace';
import { DocumentDetailsList, ExportLibraryButton, ExportList, LibrarySetupPanel, LoadCatalogButton, type LibraryDocument, type LibraryExportRow } from '@/components/policy/library-setup';
import { ReviewQueuePanel, type QueueData } from '@/components/policy/review-queue';
import { SetupChecklist, checklistSteps } from '@/components/policy/setup-checklist';
import { apiGet, getCurrentUser } from '@/lib/api';

export const metadata: Metadata = { title: 'Policy rules' };

/**
 * The project's Policy page. A policy-library project (KYC Judgment; D-090–D-092, owner 26 Nov 2026) opens with the
 * setup checklist (Documents → Facts → AI suggestions → Review → Export) and approves rules in the review queue only;
 * the annotation table (Mandatory marking / Applies when / Why / Apply to project) is not shown there. Every other
 * project keeps the page as it was.
 */
export default async function ProjectPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await apiGet<ProjectDto>(`/projects/${id}`);
  if (!project) notFound();
  const [docs, extraction, rules, preview, user, queue, catalog, exportsList, enrichment] = await Promise.all([
    apiGet<DocumentsData>(`/projects/${id}/policy/documents`),
    apiGet<ExtractionData>(`/projects/${id}/policy/extraction`),
    apiGet<{ items: RuleRow[] }>(`/projects/${id}/policy/rules`),
    apiGet<PreviewData>(`/projects/${id}/policy/rule-set/preview`),
    getCurrentUser(),
    apiGet<QueueData>(`/projects/${id}/policy/review-queue`),
    apiGet<{ catalog: { catalog_id?: string; facts?: unknown[] } | null; version: number | null }>(`/projects/${id}/policy/fact-catalog`),
    apiGet<{ items: LibraryExportRow[] }>(`/projects/${id}/policy/library-exports`),
    apiGet<{ status: string; message?: string; result?: Record<string, unknown> }>(`/projects/${id}/policy/enrichment`),
  ]);
  const isAdmin = user?.roles.includes('ADMIN') ?? false;
  const documents = docs.data ?? { maxPages: 20, items: [] };
  const libraryDocs = documents.items as unknown as LibraryDocument[];
  const cat = { version: catalog.data?.version ?? null, catalogId: catalog.data?.catalog?.catalog_id ?? null, facts: catalog.data?.catalog?.facts?.length ?? 0 };
  const exportsRows = exportsList.data?.items ?? [];
  const header = (
    <>
      <Link href={`/projects/${id}`} className="text-sm text-link hover:underline">
        ← {project.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Policy rules</h1>
    </>
  );

  if (queue.data?.approvalRoute !== 'review_queue') {
    return (
      <div>
        {header}
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Add the project’s policy documents, extract candidate rules, review each rule against its source, then publish one rule set. Every task in this project inherits the published set. Extraction suggests; only a person marks a rule Reviewed.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/review/policy-proposals" className="text-link hover:underline">Documents proposed by SMEs</Link> appear here once an Expert or you accept them.
        </p>
        <PolicyWorkspace projectId={id} isAdmin={isAdmin} documents={documents} extraction={extraction.data} rules={rules.data?.items ?? []} preview={preview.data} />
        <ReviewQueuePanel projectId={id} initial={queue.data} enrichment={enrichment.data as never} />
        <LibrarySetupPanel projectId={id} documents={libraryDocs} catalog={cat} exports={exportsRows} />
      </div>
    );
  }

  const q = queue.data;
  const drafts = q.items.length;
  const steps = checklistSteps({
    documents: libraryDocs,
    catalog: cat,
    drafts,
    draftsWithLibrary: q.items.filter((r) => !r.flags.some((f) => f.code === 'library_incomplete')).length,
    enrichment: enrichment.data ?? null,
    counts: q.counts ?? { rules: drafts, approved: 0, excluded: 0 },
    ready: q.items.filter((r) => r.flags.length === 0).length,
    exports: exportsRows,
  });
  return (
    <div>
      {header}
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">
        Build this project’s policy library: describe each document, load the facts, let the AI suggest the details, review and confirm each rule against its source, then export. AI suggests; only you approve a rule, in the review queue.
      </p>
      <SetupChecklist steps={steps} />

      <section id="documents" aria-labelledby="docs-step-h" className="mt-6 space-y-4">
        <h2 id="docs-step-h" className="text-lg font-semibold">
          1. Documents
        </h2>
        <div className="card p-4">
          <h3 className="font-semibold">Document details</h3>
          <p className="text-sm text-fg-muted">Kind, jurisdiction (ISO, for example US or US-CA), where an official text came from, and the date each document is in force from. Rules without their own date take their document’s date. You can change these at any time.</p>
          <DocumentDetailsList projectId={id} documents={libraryDocs} />
        </div>
        <Documents projectId={id} data={documents} />
        <Extraction projectId={id} isAdmin={isAdmin} data={extraction.data} documents={documents} />
      </section>

      <section id="facts" aria-labelledby="facts-step-h" className="card mt-6 p-4 text-sm">
        <h2 id="facts-step-h" className="text-lg font-semibold">
          2. Facts
        </h2>
        {cat.version ? (
          <p>
            Fact catalog <span className="font-mono">{cat.catalogId ?? 'project'}</span>, version {cat.version}: {cat.facts} facts. Conditions are written over these facts.
          </p>
        ) : (
          <>
            <p>No fact catalog yet, so conditions can’t be checked. Load the facts the environment knows about cases.</p>
            <div className="mt-2">
              <LoadCatalogButton projectId={id} primary />
            </div>
          </>
        )}
      </section>

      <p className="mt-6 text-sm text-fg-muted">3. AI suggestions and 4. Review are in the review queue below: choose a document to run the AI for its drafts only.</p>
      <ReviewQueuePanel projectId={id} initial={q} enrichment={enrichment.data as never} />

      <section id="export" aria-labelledby="export-step-h" className="card mt-6 p-4 text-sm">
        <h2 id="export-step-h" className="text-lg font-semibold">
          5. Export
        </h2>
        <p className="text-fg-muted">The policy library the benchmark serves (C1): every approved rule, with its versions. If something is missing, the export lists it and nothing is exported.</p>
        <div className="mt-2">
          <ExportLibraryButton projectId={id} />
        </div>
        <ExportList projectId={id} exports={exportsRows} />
      </section>
      <div className="mt-6">
        <Publish projectId={id} preview={preview.data} />
      </div>
    </div>
  );
}
