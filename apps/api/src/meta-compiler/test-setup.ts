import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { HarborBlueprint, identityEligible, ONBOARDING_ITEMS, ONBOARDING_VERSION, TERMS_KEYS, type HarborBlueprintInput } from '@praxis/shared';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import { assignmentEligibility, currentTerms } from '../candidate/onboarding-service';
import type { ObjectStorage } from '../candidate/storage';
import type { Config } from '../config';
import type { Db, Tx } from '../db';
import type { HarborRunner } from '../harbor/runner';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { writeAudit, type AuditContext } from '../platform/audit';
import { isComplete, serverProblems } from './blueprint';
import type { MetaCompilerDeps } from './deps';
import { passedGates } from './deployments';
import type { DrafterFactory } from './drafter';
import { processGeneration, progress, promptHashOf } from './generation';
import { pendingChecks, processVerification } from './verification';

/**
 * D4a one-step synthetic test setup (S4-14): a deployed example template, a project, a test SME and a separate test
 * Reviewer. Everything is synthetic, found by fixed names and reused on every call, and audited. Review rules are
 * unchanged: the SME's commit goes to the independent Reviewer, never to the Admin who ran the setup.
 */
export const TEST_SETUP = {
  domain: 'Meta-Compiler Test',
  workflow: 'Synthetic studio test workflow',
  project: 'Meta-Compiler test project',
  studioId: 'mc-test-setup',
} as const;

const COVERAGE = { dimensions: [{ key: 'channel', label: 'Channel', values: ['search', 'social', 'video'] }], cells: [] };

export function testSetupBlueprint(): HarborBlueprint {
  const input: HarborBlueprintInput = {
    studio_id: TEST_SETUP.studioId,
    catalog: {
      primary_work: 'Plan a synthetic six-week launch budget for a fictional product.',
      verification_criteria: 'Allocations respect the CAC ceiling and the oracle keyword table.',
      human_gate: 'An independent Reviewer checks the oracle table before approval.',
      skills: ['Performance marketing'],
      task_modes: ['AUTHORING'],
      coverage_dimensions: COVERAGE,
    },
    template_meta: { template_id: 'mc-test-setup', label: TEST_SETUP.workflow, domain_category: 'Test', tpt_minutes: 30, tpt_label: '30m (6 Wks)', modes: ['HERMETIC_MCP'] },
    domain_meta: { title: 'Synthetic launch plan (test)', persona_label: 'Growth Marketing Lead', horizon: { type: 'episodic_loop', max_turns: 6, cadence_unit: 'Wks' } },
    step_2_data_panels: {
      public_dropzones: [{ id: 'queries', label: 'Search queries', target_path: '/workspace/inputs/queries.csv', format: 'csv' }],
      oracle_annotator: {
        dataset_name: 'keyword_intent',
        target_path: '/eval/ground_truth/keyword_intent.csv',
        columns: ['keyword', 'intent'],
        sme_tag_options: ['BUY', 'RESEARCH', 'IGNORE'],
        template_preview_rows: [['fictional gadget deal', 'BUY']],
      },
    },
    step_3_mcp_simulators: {
      tools: [{ tool_id: 'advance_campaign_week', parameters: [{ name: 'spend_usd', type: 'number' }] }],
      widgets: [{ archetype: 'diminishing_returns_curve_slider', key: 'k_half', label: 'Saturation (K_half)', min: 1000, max: 50000, default: 12000, step: 500 }],
    },
    step_4_invariant_catalog: { allowed_subjects: ['weekly_cac_usd'], rules: [{ id: 'cac_ceiling', subject: 'weekly_cac_usd', operator: 'GREATER_THAN', threshold: 42 }] },
    step_5_default_rubric: {
      milestones: [
        { id: 'intent_f1', label: 'Keyword intent', weight: 60, verifier_template: 'f1_set_match', verifier_body: 'assert env_state["f1"] >= 0.9' },
        { id: 'budget_lp', label: 'Budget allocation', weight: 40, verifier_template: 'lp_solver_ceiling', verifier_body: 'assert env_state["budget_ok"]' },
      ],
    },
    custom_fields_by_stage: {
      stage_3: [{ field_id: 'target_cac_ceiling', label: 'Target CAC ceiling', input_type: 'currency_slider', min: 10, max: 100, default_value: 42, inject_into: ['instruction.md', 'task.json'] }],
    },
    authored_content: { instruction_md: 'Plan the fictional launch budget week by week.', solve_sh: '#!/bin/sh\necho solved > /workspace/out.txt\n' },
  };
  return HarborBlueprint.parse(input);
}

export interface Fixtures {
  templateId: string;
  templateVersion: number;
  projectId: string;
  projectName: string;
  smeUserId: string;
  candidateId: string;
  smeEmail: string;
  reviewerUserId: string;
  reviewerEmail: string;
  temporaryPassword: string | null;
  created: string[];
}

type Audit = (input: Parameters<typeof writeAudit>[2]) => Promise<void>;

const tag = (clientId: string) => clientId.slice(0, 8);
export const testSmeEmail = (clientId: string) => `mc-test-sme+${tag(clientId)}@example.test`;
export const testReviewerEmail = (clientId: string) => `mc-test-reviewer+${tag(clientId)}@example.test`;

/** Step 1, one transaction: template, project, Reviewer and SME, created or reused. `smeEmail` picks an existing SME. */
export async function ensureFixtures(tx: Tx, args: { clientId: string; adminId: string; smeEmail?: string }, audit: Audit): Promise<Fixtures> {
  const { clientId, adminId } = args;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mc-test-setup:${clientId}`}))`;
  const created: string[] = [];

  const domain = (await tx.domain.findFirst({ where: { clientId, name: TEST_SETUP.domain } })) ?? (created.push('domain'), await tx.domain.create({ data: { clientId, name: TEST_SETUP.domain } }));
  let template = await tx.template.findFirst({ where: { clientId, domainId: domain.id, workflowName: TEST_SETUP.workflow, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
  if (!template) {
    const bp = testSetupBlueprint();
    const probe = { clientId, lineageId: '00000000-0000-0000-0000-000000000000' };
    if (!isComplete(await serverProblems(tx, probe, bp))) throw new AppError(409, 'TEST_SETUP_CONFLICT', `The Studio Blueprint ID "${bp.studio_id}" is already used by another workflow.`);
    const c = bp.catalog;
    template = await tx.template.create({
      data: {
        clientId,
        domainId: domain.id,
        lineageId: randomUUID(),
        workflowName: TEST_SETUP.workflow,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        primaryWork: c.primary_work,
        verificationCriteria: c.verification_criteria,
        humanGate: c.human_gate,
        skills: c.skills,
        taskModes: c.task_modes,
        coverageDimensions: c.coverage_dimensions as Prisma.InputJsonValue,
        defaultTptMinutes: bp.template_meta.tpt_minutes,
        executionMode: 'HERMETIC_MCP',
        openSlotShare: 0,
        blueprint: bp as unknown as Prisma.InputJsonValue,
      },
    });
    created.push('template');
    await audit({ entityType: 'Template', entityId: template.id, action: 'test_setup.template_created', after: { workflowName: template.workflowName, version: template.version, studioId: bp.studio_id } });
  }

  let project = await tx.project.findFirst({ where: { clientId, name: TEST_SETUP.project, template: { lineageId: template.lineageId } }, orderBy: { createdAt: 'desc' } });
  if (!project) {
    project = await tx.project.create({
      data: { clientId, ownerId: adminId, templateId: template.id, templateVersion: template.version, name: TEST_SETUP.project, status: 'STAFFED', taskMode: 'AUTHORING', distinctTarget: 20, maxPerExpert: 20, openSlotShare: 0, tptMinutes: 30 },
    });
    created.push('project');
    await audit({ entityType: 'Project', entityId: project.id, action: 'test_setup.project_created', after: { name: project.name, templateId: template.id, templateVersion: template.version } });
  }

  // A separate Reviewer (never the Admin running the setup): the temporary password is shown once, on creation.
  const reviewerEmail = testReviewerEmail(clientId);
  let reviewer = await tx.user.findUnique({ where: { email: reviewerEmail } });
  let temporaryPassword: string | null = null;
  if (reviewer && reviewer.clientId !== clientId) throw new AppError(409, 'TEST_SETUP_CONFLICT', 'The test Reviewer email belongs to another client.');
  if (!reviewer) {
    temporaryPassword = generateTemporaryPassword();
    reviewer = await tx.user.create({ data: { clientId, email: reviewerEmail, name: 'Test Reviewer (synthetic)', roles: ['REVIEWER'], passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true } });
    created.push('reviewer');
    await audit({ entityType: 'User', entityId: reviewer.id, action: 'test_setup.reviewer_created', after: { email: reviewerEmail, roles: ['REVIEWER'] } });
  }
  if (!(await tx.projectReviewer.findUnique({ where: { projectId_userId: { projectId: project.id, userId: reviewer.id } } }))) {
    await tx.projectReviewer.create({ data: { clientId, projectId: project.id, userId: reviewer.id, assignedById: adminId } });
    await audit({ entityType: 'Project', entityId: project.id, action: 'test_setup.reviewer_assigned', after: { userId: reviewer.id } });
  }

  const sme = await ensureSme(tx, { clientId, smeEmail: args.smeEmail }, created, audit);
  if (sme.smeUserId === adminId || sme.email === reviewerEmail) throw new AppError(422, 'SELF_REVIEW', 'The test SME must be a different person from the Admin and the Reviewer.');
  if (!(await tx.projectAssignment.findFirst({ where: { projectId: project.id, candidateId: sme.candidateId, releasedAt: null } }))) {
    await tx.projectAssignment.create({ data: { clientId, projectId: project.id, candidateId: sme.candidateId } });
    await audit({ entityType: 'Project', entityId: project.id, action: 'test_setup.sme_assigned', after: { candidateId: sme.candidateId } });
  }
  await ensureSelected(tx, { clientId, adminId, smeUserId: sme.smeUserId, projectId: project.id, domain: domain.name }, created, audit);
  const gate = await assignmentEligibility(tx, { smeUserId: sme.smeUserId, projectId: project.id });
  if (!gate.ok) throw new AppError(409, 'SME_NOT_READY', `The test SME cannot work on the project yet: ${gate.reason}.`);

  return {
    templateId: template.id,
    templateVersion: template.version,
    projectId: project.id,
    projectName: project.name,
    smeUserId: sme.smeUserId,
    candidateId: sme.candidateId,
    smeEmail: sme.email,
    reviewerUserId: reviewer.id,
    reviewerEmail,
    temporaryPassword,
    created,
  };
}

/**
 * The synthetic SME signs in locally with the mock Google token for its email (subject `mock-<email>`). In staging a
 * tester passes `smeEmail` of the candidate account they already signed in with; that account is used as it is.
 */
async function ensureSme(tx: Tx, args: { clientId: string; smeEmail?: string }, created: string[], audit: Audit) {
  const { clientId } = args;
  if (args.smeEmail) {
    const u = await tx.smeUser.findFirst({ where: { clientId, contactEmail: { equals: args.smeEmail, mode: 'insensitive' } }, include: { candidate: true } });
    if (!u) throw new AppError(404, 'SME_NOT_FOUND', 'No candidate account with this email: sign in to the candidate app once first.');
    if (u.accountStatus !== 'ACTIVE' || !identityEligible(u.identityStatus)) throw new AppError(409, 'SME_NOT_READY', 'This candidate account must be active and identity-verified first.');
    if (!u.candidate) throw new AppError(409, 'SME_NOT_READY', 'This candidate has no profile yet: complete the profile in the candidate app first.');
    return { smeUserId: u.id, candidateId: u.candidate.id, email: args.smeEmail };
  }
  const email = testSmeEmail(clientId);
  const subject = `mock-${email.toLowerCase()}`;
  const pid = await tx.providerIdentity.findUnique({ where: { provider_subject: { provider: 'GOOGLE', subject } }, include: { smeUser: { include: { candidate: true } } } });
  if (pid?.smeUser.candidate && pid.smeUser.clientId === clientId) return { smeUserId: pid.smeUserId, candidateId: pid.smeUser.candidate.id, email };
  if (pid) throw new AppError(409, 'TEST_SETUP_CONFLICT', 'The test SME sign-in is linked to another account.');
  const u = await tx.smeUser.create({ data: { clientId, displayName: 'Test SME (synthetic)', contactEmail: email, adultAttestedAt: new Date(), identityStatus: 'VERIFIED' } });
  await tx.providerIdentity.create({ data: { clientId, smeUserId: u.id, provider: 'GOOGLE', subject, emailAtLink: email } });
  const c = await tx.candidate.create({
    data: { clientId, smeUserId: u.id, country: 'GB', languages: [{ language: 'en', level: 'C2' }], specialties: ['Marketing'], skills: ['Performance marketing'], jurisdictions: [], domainExperienceYears: 5, hoursPerWeek: 20, timezone: 'Europe/London', lastValidatedAt: new Date() },
  });
  created.push('sme');
  await audit({ entityType: 'SmeUser', entityId: u.id, action: 'test_setup.sme_created', after: { email, candidateId: c.id, synthetic: true } });
  return { smeUserId: u.id, candidateId: c.id, email };
}

/**
 * The selection and onboarding records the work checks need, decided by the Admin who ran the setup (a person, as
 * FLOW 2 requires) and marked as the synthetic test setup in the decision and the audit trail.
 */
async function ensureSelected(tx: Tx, a: { clientId: string; adminId: string; smeUserId: string; projectId: string; domain: string }, created: string[], audit: Audit) {
  const { clientId, adminId, smeUserId, projectId } = a;
  const opp = (await tx.opportunity.findUnique({ where: { projectId } })) ?? (await tx.opportunity.create({ data: { clientId, projectId, status: 'PUBLISHED' } }));
  const ov =
    (await tx.opportunityVersion.findFirst({ where: { opportunityId: opp.id }, orderBy: { version: 'desc' } })) ??
    (await tx.opportunityVersion.create({ data: { clientId, opportunityId: opp.id, version: 1, brief: { title: 'Synthetic test opportunity' }, criteria: [], questionPolicy: {}, scope: {}, ownerId: adminId, publishedAt: new Date(), publishedById: adminId } }));
  const existing = await tx.enrollment.findUnique({ where: { smeUserId_opportunityId: { smeUserId, opportunityId: opp.id } }, include: { onboarding: true } });
  if (existing?.status === 'SELECTED' && existing.onboarding?.status === 'COMPLETE') return;
  if (existing && existing.status !== 'DRAFT') throw new AppError(409, 'SME_NOT_READY', `The test SME already has an application for this project (${existing.status.toLowerCase()}).`);

  const last = await tx.profileVersion.findFirst({ where: { smeUserId }, orderBy: { version: 'desc' } });
  const data = { synthetic: true, summary: 'Synthetic profile for the Meta-Compiler test setup (D4a).' };
  const enrollment = existing ?? (await tx.enrollment.create({ data: { clientId, smeUserId, opportunityId: opp.id, opportunityVersionId: ov.id } }));
  const pv = await tx.profileVersion.create({ data: { clientId, smeUserId, enrollmentId: enrollment.id, version: (last?.version ?? 0) + 1, data, contentHash: sha256(stableStringify(data)), submittedAt: new Date() } });
  const decision = await tx.selectionDecision.create({
    data: {
      clientId,
      enrollmentId: enrollment.id,
      reviewerId: adminId,
      outcome: 'SELECTED',
      reasons: { items: [{ text: 'Synthetic Meta-Compiler test setup (D4a)' }], candidateMessage: 'Selected for the synthetic test project.', informationRequest: null },
      profileVersionId: pv.id,
      criteriaRef: { opportunityVersionId: ov.id, version: ov.version, criteria: ov.criteria, testSetup: true } as Prisma.InputJsonValue,
    },
  });
  await tx.qualificationScope.create({ data: { clientId, enrollmentId: enrollment.id, selectionDecisionId: decision.id, domain: a.domain, jurisdictions: [], languages: ['en'], contributionRoles: ['TASK_AUTHOR'] } });
  await tx.enrollment.update({ where: { id: enrollment.id }, data: { status: 'SELECTED', profileVersionId: pv.id, submittedAt: new Date(), revision: { increment: 1 } } });

  const terms = await currentTerms(tx, clientId);
  const checklist = await tx.onboardingChecklist.upsert({
    where: { enrollmentId: enrollment.id },
    create: { clientId, enrollmentId: enrollment.id, checklistVersion: ONBOARDING_VERSION, items: ONBOARDING_ITEMS.map((i) => i.key) as Prisma.InputJsonValue, status: 'COMPLETE', completedAt: new Date() },
    update: { status: 'COMPLETE', completedAt: new Date(), blockReason: null },
  });
  const answers: Record<string, unknown> = {
    conflicts: { hasConflicts: false, authorizedToContribute: true },
    preferences: { country: 'GB', languages: [{ language: 'en', level: 'C2' }], timezone: 'Europe/London', hoursPerWeek: 20, emailNotifications: false },
  };
  for (const item of ONBOARDING_ITEMS) {
    const doc = item.termsKey ? terms[TERMS_KEYS.indexOf(item.termsKey)] : null;
    if (item.termsKey && !doc) throw new AppError(409, 'SME_NOT_READY', 'Publish the contributor terms before running the test setup.');
    await tx.onboardingAcknowledgement.upsert({
      where: { checklistId_itemKey: { checklistId: checklist.id, itemKey: item.key } },
      create: { clientId, checklistId: checklist.id, itemKey: item.key, termsHash: doc?.sha256 ?? null, data: (answers[item.key] ?? null) as Prisma.InputJsonValue },
      update: { termsHash: doc?.sha256 ?? null },
    });
  }
  created.push('selection');
  await audit({ entityType: 'Enrollment', entityId: enrollment.id, action: 'test_setup.sme_selected', after: { smeUserId, projectId, decisionId: decision.id, decidedBy: adminId, onboarding: 'COMPLETE', synthetic: true } });
}

export interface VerifyDeps {
  db: Db;
  storage: ObjectStorage;
  config: Config;
  drafters: DrafterFactory;
  deps: MetaCompilerDeps;
  runner: HarborRunner;
}

/**
 * Step 2: a succeeded blueprint generation and a passing measured verification of the test template, reused when
 * present. They run inline with the configured runner (the blueprint is complete, so no model call is made).
 */
export async function ensureVerified(w: VerifyDeps, f: Pick<Fixtures, 'templateId'>, ctx: AuditContext & { actorId: string }): Promise<string> {
  const { db } = w;
  const t = await db.template.findUniqueOrThrow({ where: { id: f.templateId } });
  const bp = HarborBlueprint.parse(t.blueprint);
  const choice = { provider: 'mock' as const, model: 'mock-drafter-1' };
  const promptHash = promptHashOf(bp, 'BLUEPRINT', choice.provider, choice.model);
  const key = { templateId_promptHash_mode_model: { templateId: t.id, promptHash, mode: 'BLUEPRINT' as const, model: choice.model } };
  const passing = await db.compilerVerificationRun.findFirst({ where: { generationRun: { templateId: t.id, promptHash }, status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' } });
  if (passing && passedGates(passing)) return passing.id;
  const audited = async <T>(fn: (tx: Tx) => Promise<T>, input: (r: T) => Parameters<typeof writeAudit>[2]) =>
    db.$transaction(async (tx) => {
      const r = await fn(tx);
      await writeAudit(tx, ctx, input(r));
      return r;
    });

  let g = await db.compilerGenerationRun.findUnique({ where: key });
  if (!g || g.status !== 'SUCCEEDED') {
    const data = { status: 'QUEUED' as const, estimatedCostUsd: 0, error: null, progress: progress(0, 0, 'Queued'), finishedAt: null, requestedById: ctx.actorId };
    g = await audited(
      (tx) => (g ? tx.compilerGenerationRun.update({ where: { id: g.id }, data }) : tx.compilerGenerationRun.create({ data: { ...data, clientId: t.clientId, templateId: t.id, templateVersion: t.version, mode: 'BLUEPRINT', ...choice, promptHash } })),
      (r) => ({ entityType: 'CompilerGenerationRun', entityId: r.id, action: 'meta_compiler.generation_requested', after: { templateId: t.id, templateVersion: t.version, mode: 'BLUEPRINT', ...choice, promptHash, testSetup: true } }),
    );
    await processGeneration(w, g.id);
    g = await db.compilerGenerationRun.findUniqueOrThrow({ where: { id: g.id } });
    if (g.status !== 'SUCCEEDED') throw new AppError(502, 'TEST_SETUP_FAILED', `Generating the test template failed: ${g.error ?? g.status}`);
  }
  const genId = g.id;
  const v = await audited(
    (tx) => tx.compilerVerificationRun.create({ data: { clientId: t.clientId, generationRunId: genId, requestedById: ctx.actorId, checks: pendingChecks() as unknown as Prisma.InputJsonValue } }),
    (r) => ({ entityType: 'CompilerVerificationRun', entityId: r.id, action: 'meta_compiler.verification_requested', after: { generationRunId: genId, templateId: t.id, runner: w.runner.kind, testSetup: true } }),
  );
  await processVerification(w, v.id);
  const done = await db.compilerVerificationRun.findUniqueOrThrow({ where: { id: v.id } });
  if (!passedGates(done)) throw new AppError(502, 'TEST_SETUP_FAILED', `Verifying the test template failed: ${done.error ?? done.status}`);
  return done.id;
}
