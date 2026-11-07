import type { Prisma } from '@prisma/client';
import type { SmeAuthoredTaskDto } from '@praxis/shared';

export const authoredTaskInclude = {
  template: { select: { workflowName: true } },
  project: { select: { name: true } },
  taskInstance: { select: { status: true } },
  candidate: { select: { smeUser: { select: { contactEmail: true, displayName: true } } } },
} satisfies Prisma.SmeAuthoredTaskInclude;

export type AuthoredTaskRow = Prisma.SmeAuthoredTaskGetPayload<{ include: typeof authoredTaskInclude }>;

/** S4-11: the task store row. `authoredBy` (the SME's email) only in the Admin view (NFR-05). */
export function authoredTaskDto(t: AuthoredTaskRow, admin: boolean): SmeAuthoredTaskDto {
  const sme = t.candidate.smeUser;
  return {
    id: t.id,
    externalTaskId: t.externalTaskId,
    taskInstanceId: t.taskInstanceId,
    submissionVersion: t.submissionVersion,
    templateId: t.templateId,
    templateVersion: t.templateVersion,
    workflowName: t.template.workflowName,
    projectId: t.projectId,
    projectName: t.project.name,
    authoredBy: admin ? (sme.contactEmail ?? sme.displayName ?? null) : null,
    title: t.title,
    executionMode: t.executionMode,
    bundleSha256: t.bundleSha256,
    zeroBaselineScore: t.zeroBaselineScore === null ? null : Number(t.zeroBaselineScore),
    oracleScore: t.oracleScore === null ? null : Number(t.oracleScore),
    dataClassification: t.dataClassification,
    reviewStatus: t.taskInstance.status,
    createdAt: t.createdAt.toISOString(),
  };
}
