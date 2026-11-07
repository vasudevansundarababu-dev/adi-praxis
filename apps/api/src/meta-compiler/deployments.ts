import type { StudioDeployment } from '@prisma/client';
import { HarborBlueprint, type StudioDeploymentDto } from '@praxis/shared';
import { randomBytes } from 'node:crypto';
import type { Tx } from '../db';
import { AppError, notFound } from '../lib/errors';
import type { CommandContext } from '../platform/command';
import { activeAssignment } from '../tasks/task-service';
import { studioUrl } from './directory';

export function deploymentDto(d: StudioDeployment, candidateAppUrl: string): StudioDeploymentDto {
  return {
    id: d.id,
    templateId: d.templateId,
    templateVersion: d.templateVersion,
    projectId: d.projectId,
    smeCandidateId: d.candidateId,
    studioKey: d.studioKey,
    studioUrl: studioUrl(candidateAppUrl, d.studioKey),
    status: d.status,
    runtime: d.runtime,
    createdAt: d.createdAt.toISOString(),
  };
}

/** Deploy needs a measured, passing verification of this template version: zero baseline 0.00 and oracle 1.00 (S3-05, D-12). */
export const passedGates = (v: { status: string; zeroBaselineScore: unknown; oracleScore: unknown }) =>
  v.status === 'SUCCEEDED' && v.zeroBaselineScore !== null && Number(v.zeroBaselineScore) === 0 && v.oracleScore !== null && Number(v.oracleScore) === 1;

/**
 * Step 3 (S3-05 to S3-07, S3-09, D14). One studio per (template lineage, project, SME): a redeploy updates that row in
 * the same transaction that checks the new verification, so the previous version stays live until the new one is
 * active, and the studio key (and its URL) never changes.
 */
export async function deployStudio(
  ctx: CommandContext,
  args: { templateId: string; verificationRunId: string; projectId: string; candidateId: string; candidateAppUrl: string },
): Promise<{ status: number; body: StudioDeploymentDto }> {
  const { tx, actor, audit } = ctx;
  const t = await tx.template.findFirst({ where: { id: args.templateId, clientId: actor.clientId } });
  if (!t) throw notFound('Template not found');
  const v = await tx.compilerVerificationRun.findFirst({ where: { id: args.verificationRunId, clientId: actor.clientId }, include: { generationRun: true } });
  if (!v) throw notFound('Verification run not found');
  if (v.generationRun.templateId !== t.id) throw new AppError(422, 'VERIFICATION_MISMATCH', 'This verification belongs to another template version.');
  if (!passedGates(v)) throw new AppError(409, 'VERIFICATION_REQUIRED', 'Deploy needs a verification with zero baseline 0.00 and oracle 1.00 for this version.');
  if (v.generationRun.mode !== 'BLUEPRINT') throw new AppError(409, 'RUNTIME_UNAVAILABLE', 'Generated studio code needs the isolated runtime (Phase C); deploy a blueprint generation.');
  const project = await tx.project.findFirst({ where: { id: args.projectId, clientId: actor.clientId }, include: { template: { select: { lineageId: true } } } });
  if (!project) throw notFound('Project not found');
  if (project.template.lineageId !== t.lineageId) throw new AppError(422, 'PROJECT_NOT_ELIGIBLE', 'This project does not use this workflow.');
  const candidate = await tx.candidate.findFirst({ where: { id: args.candidateId, clientId: actor.clientId } });
  if (!candidate) throw notFound('SME not found');
  if (!(await activeAssignment(tx, project.id, candidate.id))) throw new AppError(422, 'SME_NOT_ASSIGNED', 'This SME is not assigned to the project.');

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`studio:${t.lineageId}:${project.id}:${candidate.id}`}))`;
  const where = { templateLineageId_projectId_candidateId: { templateLineageId: t.lineageId, projectId: project.id, candidateId: candidate.id } };
  const existing = await tx.studioDeployment.findUnique({ where });
  const target = { templateId: t.id, templateVersion: t.version, verificationRunId: v.id };
  if (existing && existing.status === 'ACTIVE' && existing.verificationRunId === v.id && existing.templateId === t.id) {
    await audit({ entityType: 'StudioDeployment', entityId: existing.id, action: 'studio.deploy_unchanged', after: target });
    return { status: 200, body: deploymentDto(existing, args.candidateAppUrl) };
  }
  const d = existing
    ? await tx.studioDeployment.update({ where: { id: existing.id }, data: { ...target, status: 'ACTIVE', stoppedAt: null, stoppedById: null, deployedById: actor.userId } })
    : await tx.studioDeployment.create({
        data: { ...target, clientId: actor.clientId, templateLineageId: t.lineageId, projectId: project.id, candidateId: candidate.id, deployedById: actor.userId, studioKey: await newStudioKey(tx, t.blueprint), runtime: 'SHARED' },
      });
  await audit({
    entityType: 'StudioDeployment',
    entityId: d.id,
    action: existing ? 'studio.redeployed' : 'studio.deployed',
    before: existing ? { templateId: existing.templateId, templateVersion: existing.templateVersion, verificationRunId: existing.verificationRunId, status: existing.status } : undefined,
    after: { ...target, projectId: project.id, candidateId: candidate.id, studioKey: d.studioKey, zeroBaselineScore: Number(v.zeroBaselineScore), oracleScore: Number(v.oracleScore) },
  });
  return { status: existing ? 200 : 201, body: deploymentDto(d, args.candidateAppUrl) };
}

async function newStudioKey(tx: Tx, blueprint: unknown): Promise<string> {
  const id = HarborBlueprint.safeParse(blueprint).data?.studio_id || 'studio';
  for (;;) {
    const key = `${id.slice(0, 60)}-${randomBytes(4).toString('hex')}`;
    if (!(await tx.studioDeployment.findUnique({ where: { studioKey: key } }))) return key;
  }
}
