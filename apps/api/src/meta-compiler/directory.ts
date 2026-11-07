import { HarborBlueprint, sectionProblems, validSectionCount, type DirectoryRowDto, type TemplateDirectoryResponse } from '@praxis/shared';
import type { Db } from '../db';
import { tptLabel } from './blueprint';

export const studioUrl = (candidateAppUrl: string, studioKey: string) => `${candidateAppUrl.replace(/\/$/, '')}/studio/${studioKey}`;

/**
 * Screen 1 (S1-01 to S1-11, S1-15). Admins see the newest version of every workflow; PMs see the newest PUBLISHED
 * version in active domains only, with no SME emails or studio URLs. Retired workflows leave the directory (S1-16)
 * unless an Admin asks for them. A fixed number of queries, whatever the catalog size (NFR-12).
 */
export async function templateDirectory(db: Db, args: { clientId: string; view: 'ADMIN' | 'PM'; includeRetired: boolean; candidateAppUrl: string }): Promise<TemplateDirectoryResponse> {
  const admin = args.view === 'ADMIN';
  const [domains, templates] = await Promise.all([
    db.domain.findMany({ where: { clientId: args.clientId, status: 'ACTIVE' }, orderBy: { name: 'asc' } }),
    db.template.findMany({
      where: { clientId: args.clientId, domain: { status: 'ACTIVE' }, ...(admin ? {} : { status: 'PUBLISHED' }) },
      orderBy: [{ workflowName: 'asc' }, { version: 'desc' }],
    }),
  ]);
  const newest = new Map<string, (typeof templates)[number]>();
  for (const t of templates) if (!newest.has(t.lineageId)) newest.set(t.lineageId, t);
  const shown = [...newest.values()].filter((t) => args.includeRetired || t.status !== 'RETIRED');
  const lineages = shown.map((t) => t.lineageId);
  const shownIds = shown.map((t) => t.id);

  const [deployments, projects, authored, running, verified] = await Promise.all([
    db.studioDeployment.findMany({
      where: { clientId: args.clientId, templateLineageId: { in: lineages }, status: 'ACTIVE' },
      include: { project: { select: { name: true } }, candidate: { select: { smeUser: { select: { contactEmail: true } } } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.project.findMany({ where: { clientId: args.clientId, template: { lineageId: { in: lineages } } }, select: { template: { select: { lineageId: true } } } }),
    db.smeAuthoredTask.findMany({ where: { clientId: args.clientId, template: { lineageId: { in: lineages } } }, select: { template: { select: { lineageId: true } } } }),
    admin ? db.compilerGenerationRun.findMany({ where: { clientId: args.clientId, templateId: { in: shownIds }, status: { in: ['QUEUED', 'RUNNING'] } }, select: { templateId: true } }) : [],
    admin
      ? db.compilerVerificationRun.findMany({ where: { clientId: args.clientId, status: 'SUCCEEDED', zeroBaselineScore: 0, oracleScore: 1, generationRun: { templateId: { in: shownIds } } }, select: { generationRun: { select: { templateId: true } } } })
      : [],
  ]);
  const count = (rows: { template: { lineageId: string } }[]) => rows.reduce((m, r) => m.set(r.template.lineageId, (m.get(r.template.lineageId) ?? 0) + 1), new Map<string, number>());
  const projectCount = count(projects);
  const authoredCount = count(authored);
  const generating = new Set(running.map((r) => r.templateId));
  const verifiedIds = new Set(verified.map((v) => v.generationRun.templateId));

  const rowFor = (t: (typeof shown)[number]): DirectoryRowDto => {
    const parsed = t.blueprint === null ? null : HarborBlueprint.safeParse(t.blueprint);
    const bp = parsed?.success ? parsed.data : null;
    const deps = deployments.filter((d) => d.templateLineageId === t.lineageId);
    const tpt = tptLabel(bp, t.defaultTptMinutes);
    const activeHere = deps.some((d) => d.templateId === t.id);
    const status: DirectoryRowDto['status'] = activeHere ? 'ACTIVE' : generating.has(t.id) ? 'GENERATING' : verifiedIds.has(t.id) ? 'VERIFIED' : t.status;
    return {
      templateId: t.id,
      lineageId: t.lineageId,
      version: t.version,
      workflowName: t.workflowName,
      templateStatus: t.status,
      status,
      tptMinutes: tpt.minutes,
      tptLabel: tpt.label,
      modes: bp?.template_meta.modes.length ? bp.template_meta.modes : t.executionMode ? [t.executionMode] : [],
      validSections: bp ? validSectionCount(sectionProblems(bp)) : 0,
      hasBlueprint: bp !== null,
      variantOfId: t.variantOfId,
      projectCount: projectCount.get(t.lineageId) ?? 0,
      authoredTaskCount: authoredCount.get(t.lineageId) ?? 0,
      deployments: deps.map((d) => ({
        id: d.id,
        projectId: d.projectId,
        projectName: d.project.name,
        status: d.status,
        smeEmail: admin ? (d.candidate.smeUser.contactEmail ?? null) : null,
        studioUrl: admin ? studioUrl(args.candidateAppUrl, d.studioKey) : null,
      })),
      updatedAt: t.updatedAt.toISOString(),
    };
  };

  const out = domains
    .map((d) => ({ domainId: d.id, domainName: d.name, rows: shown.filter((t) => t.domainId === d.id).map(rowFor) }))
    // An empty domain shows "No workflows yet" to Admins and is hidden from everyone else (S1-01).
    .filter((d) => admin || d.rows.length > 0);
  const rows = out.flatMap((d) => d.rows);
  const live = rows.flatMap((r) => r.deployments);
  return {
    view: args.view,
    summary: {
      totalTemplates: rows.length,
      activeStudios: live.length,
      attachedProjects: new Set(live.map((d) => d.projectId)).size,
      attachedSmes: new Set(deployments.filter((d) => lineages.includes(d.templateLineageId)).map((d) => d.candidateId)).size,
      authoredTasks: rows.reduce((s, r) => s + r.authoredTaskCount, 0),
    },
    domains: out,
  };
}
