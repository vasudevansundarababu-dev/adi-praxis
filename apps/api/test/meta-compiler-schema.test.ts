import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCandidate, createClient, createUser, db, resetDb } from './helpers';

/** Builds the minimum chain for one authored task: template, run, verification, deployment, task instance. */
async function authoredTaskChain() {
  const client = await createClient();
  const admin = await createUser(client.id, ['ADMIN']);
  const domain = await db.domain.create({ data: { clientId: client.id, name: 'Digital Marketing' } });
  const template = await db.template.create({
    data: { clientId: client.id, domainId: domain.id, lineageId: randomUUID(), workflowName: 'Launch of Noise Cancelling Phone', status: 'PUBLISHED', blueprint: { studio_id: 'mktg-ncp' }, executionMode: 'HERMETIC_MCP' },
  });
  const project = await db.project.create({ data: { clientId: client.id, ownerId: admin.id, templateId: template.id, templateVersion: 1, name: 'PRJ-MKTG-101' } });
  const candidate = await createCandidate(client.id);
  const run = await db.compilerGenerationRun.create({
    data: { clientId: client.id, templateId: template.id, templateVersion: 1, provider: 'mock', model: 'mock', promptHash: 'h1', requestedById: admin.id, status: 'SUCCEEDED' },
  });
  const verification = await db.compilerVerificationRun.create({
    data: { clientId: client.id, generationRunId: run.id, requestedById: admin.id, status: 'SUCCEEDED', zeroBaselineScore: 0, oracleScore: 1 },
  });
  const deployment = await db.studioDeployment.create({
    data: {
      clientId: client.id, templateId: template.id, templateLineageId: template.lineageId, templateVersion: 1, projectId: project.id,
      candidateId: candidate.id, verificationRunId: verification.id, studioKey: `mktg-ncp-${randomUUID().slice(0, 8)}`, deployedById: admin.id,
    },
  });
  const task = await db.taskInstance.create({ data: { clientId: client.id, projectId: project.id, taskType: 'AUTHORING', assignedToId: candidate.id } });
  const authored = await db.smeAuthoredTask.create({
    data: {
      clientId: client.id, taskInstanceId: task.id, submissionVersion: 1, deploymentId: deployment.id, templateId: template.id, templateVersion: 1,
      projectId: project.id, candidateId: candidate.id, externalTaskId: `TASK-MKTG-${randomUUID().slice(0, 6)}`, title: 'Synthetic launch plan',
      executionMode: 'HERMETIC_MCP', taskJson: { id: 'x' }, bundleRef: 'bundles/c/abc.tar.gz', bundleSha256: 'abc', dataClassification: 'SYNTHETIC',
    },
  });
  return { client, admin, template, project, candidate, run, deployment, task, authored };
}

describe('Meta-Compiler schema (architecture section 3)', () => {
  beforeEach(resetDb);

  it('templates without a blueprint keep working (blueprint is optional, revision starts at 0)', async () => {
    const client = await createClient();
    const domain = await db.domain.create({ data: { clientId: client.id, name: 'Banking' } });
    const t = await db.template.create({ data: { clientId: client.id, domainId: domain.id, lineageId: randomUUID(), workflowName: 'Old workflow' } });
    expect(t).toMatchObject({ blueprint: null, blueprintRevision: 0, executionMode: null, variantOfId: null });
  });

  it('an authored task\'s content, bundle and classification are immutable; scores can still be recorded (D-14)', async () => {
    const { authored } = await authoredTaskChain();
    await expect(db.smeAuthoredTask.update({ where: { id: authored.id }, data: { taskJson: { id: 'changed' } } })).rejects.toThrow(/immutable/);
    await expect(db.smeAuthoredTask.update({ where: { id: authored.id }, data: { bundleSha256: 'other' } })).rejects.toThrow(/immutable/);
    await expect(db.smeAuthoredTask.update({ where: { id: authored.id }, data: { dataClassification: 'REAL_PUBLIC' } })).rejects.toThrow(/immutable/);
    const scored = await db.smeAuthoredTask.update({ where: { id: authored.id }, data: { zeroBaselineScore: 0, oracleScore: 1, verificationEvidence: { runId: 'r1' } } });
    expect(Number(scored.oracleScore)).toBe(1);
  });

  it('one studio per (lineage, project, SME); generation runs are unique per (template, prompt, mode, model) (S3-03, S3-09)', async () => {
    const { client, admin, template, project, candidate, run, deployment } = await authoredTaskChain();
    await expect(
      db.studioDeployment.create({
        data: {
          clientId: client.id, templateId: template.id, templateLineageId: template.lineageId, templateVersion: 1, projectId: project.id,
          candidateId: candidate.id, verificationRunId: (await db.compilerVerificationRun.findFirstOrThrow()).id, studioKey: 'another-key', deployedById: admin.id,
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
    await expect(
      db.compilerGenerationRun.create({ data: { clientId: client.id, templateId: template.id, templateVersion: 1, provider: 'mock', model: 'mock', promptHash: run.promptHash, requestedById: admin.id } }),
    ).rejects.toThrow(/Unique constraint/);
    expect(deployment.status).toBe('ACTIVE');
    expect(deployment.runtime).toBe('SHARED');
  });
});
