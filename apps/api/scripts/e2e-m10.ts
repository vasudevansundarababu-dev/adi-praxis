import { PrismaClient } from '@prisma/client';
import { ONBOARDING_ITEMS, ONBOARDING_VERSION } from '@praxis/shared';
import { randomUUID } from 'node:crypto';
import { previousWeek } from '../src/pay/payruns';

/**
 * Fixtures for the M10 UI smoke tests (e2e database only). Steps that are a person's decision in FLOW 2, or a
 * worker's output, are set directly here so the smoke tests can focus on the M10 screens:
 *   select <smeUserId>  — identity verified and every draft application selected by a person (with a C07 checklist)
 *   payable             — an SME with a READY payee and USD 40 earned last week; prints { smeUserId }
 * Prints JSON on stdout.
 */
const url = process.env.E2E_DATABASE_URL ?? 'postgresql://praxis:praxis@localhost:5442/praxis_e2e';
if (!/e2e/.test(new URL(url).pathname)) throw new Error('e2e-m10 only runs against an e2e database');
const db = new PrismaClient({ datasources: { db: { url } } });
const [cmd, arg] = process.argv.slice(2);
const client = await db.client.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
const admin = await db.user.findFirstOrThrow({ where: { clientId: client.id, roles: { has: 'ADMIN' } } });

if (cmd === 'select') {
  const smeUserId = arg!;
  await db.smeUser.update({ where: { id: smeUserId }, data: { identityStatus: 'VERIFIED' } });
  const enrollments = await db.enrollment.findMany({ where: { smeUserId, status: { in: ['DRAFT', 'SUBMITTED', 'REVIEW_PENDING'] } } });
  for (const e of enrollments) {
    const last = await db.profileVersion.findFirst({ where: { smeUserId }, orderBy: { version: 'desc' } });
    const pv = await db.profileVersion.create({ data: { clientId: client.id, smeUserId, enrollmentId: e.id, version: (last?.version ?? 0) + 1, data: {}, contentHash: randomUUID(), submittedAt: new Date() } });
    const d = await db.selectionDecision.create({ data: { clientId: client.id, enrollmentId: e.id, reviewerId: admin.id, outcome: 'SELECTED', reasons: [], profileVersionId: pv.id, criteriaRef: {} } });
    await db.qualificationScope.create({ data: { clientId: client.id, enrollmentId: e.id, selectionDecisionId: d.id, domain: 'Banking', specialty: 'KYC', jurisdictions: ['IN'], languages: ['en'], contributionRoles: ['TASK_AUTHOR'] } });
    await db.enrollment.update({ where: { id: e.id }, data: { status: 'SELECTED', profileVersionId: pv.id } });
    await db.onboardingChecklist.upsert({ where: { enrollmentId: e.id }, create: { clientId: client.id, enrollmentId: e.id, checklistVersion: ONBOARDING_VERSION, items: ONBOARDING_ITEMS.map((i) => i.key), status: 'NOT_STARTED' }, update: {} });
  }
  console.log(JSON.stringify({ selected: enrollments.map((e) => e.id) }));
} else if (cmd === 'payable') {
  const u = await db.smeUser.create({ data: { clientId: client.id, displayName: 'Anika Rao', contactEmail: `anika.${Date.now()}@example.test`, identityStatus: 'VERIFIED' } });
  await db.payee.create({ data: { clientId: client.id, smeUserId: u.id, provider: 'mock', payeeRef: `R-e2e-${randomUUID().slice(0, 8)}`, status: 'READY', payoutCurrency: 'INR' } });
  await db.earningEntry.create({ data: { clientId: client.id, smeUserId: u.id, amount: 40, currency: 'USD', kind: 'TASK', sourceType: 'E2EFixture', sourceId: randomUUID(), earnedAt: new Date(previousWeek().periodStart.getTime() - 6 * 86_400_000) } }); // two weeks ago: the Monday worker job drafts last week's run itself
  console.log(JSON.stringify({ smeUserId: u.id }));
} else if (cmd === 'workbench') {
  // UI-only fixture: reads are real; browser tests intercept saves. No staffing gate is bypassed in the app.
  const user = await db.smeUser.findFirstOrThrow({ where: { id: arg!, clientId: client.id } });
  const candidate = await db.candidate.upsert({ where: { smeUserId: user.id }, create: { clientId: client.id, smeUserId: user.id, specialties: [], jurisdictions: [], skills: [] }, update: {} });
  const domain = await db.domain.findFirst({ where: { clientId: client.id, name: 'Banking' } }) ?? await db.domain.create({ data: { clientId: client.id, name: 'Banking' } });
  const template = await db.template.findFirst({ where: { clientId: client.id, domainId: domain.id, workflowName: 'KYC onboarding and refresh' } }) ?? await db.template.create({ data: { clientId: client.id, domainId: domain.id, lineageId: randomUUID(), workflowName: 'KYC onboarding and refresh', status: 'PUBLISHED', skills: [], taskModes: ['AUTHORING'] } });
  const project = await db.project.create({ data: { clientId: client.id, ownerId: admin.id, templateId: template.id, templateVersion: template.version, name: `SYNTHETIC workbench UI fixture ${randomUUID()}`, status: 'IN_PROGRESS' } });
  const task = await db.taskInstance.create({ data: { clientId: client.id, projectId: project.id, taskType: 'AUTHORING', assignedToId: candidate.id, status: 'IN_PROGRESS', output: { header: { title: 'SYNTHETIC workbench UI fixture' } } } });
  console.log(JSON.stringify({ taskId: task.id, projectId: project.id }));
} else {
  throw new Error('usage: e2e-m10 select <smeUserId> | payable | workbench <smeUserId>');
}
await db.$disconnect();
