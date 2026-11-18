import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { CandidateCitation, PolicyRuleBody, ProjectRuleSetContent } from '@praxis/shared';
import type { ApprovedTaskRecord, PolicyDocument, PolicyDocumentVersion, Prisma, Project, ProjectDemographicFilter, Template } from '@prisma/client';
import { jcs, jcsSha256 } from '../anvil/jcs';
import { jointHashes, jointTemplateSpec, JOINT_TEMPLATE_SPEC, type JointTemplateSpec } from '../anvil/joint-template';
import type { ObjectStorage } from '../candidate/storage';
import { stubScanner } from '../candidate/storage';
import type { Db, Tx } from '../db';
import { emitEvent } from '../outbox/outbox';
import { writeAudit, type AuditInput } from '../platform/audit';
import { addDocumentVersion, loadVersionText } from '../policy/documents';
import { resolveCitation } from '../policy/extraction/normalise';
import { contentHash as ruleContentHash, createRuleFromCandidate } from '../policy/rules';
import { check, templateVersionHash } from '../routes/anvil-templates';
import { policyLibrary, type LibraryDocument } from '../tasks/rubric/service';
import { checkOptions, revalidateTask } from '../tasks/revalidation';
import { authoredContent, compileForSubmission } from '../tasks/profile-output';
import { ensureSlotTasks } from '../tasks/task-service';
import { snapshotTask } from '../policy/task-policy';
import type { StoredChecks } from '../tasks/submission';
import { storePack } from '../templates/golden-pack-store';
import { loadUploadedProfiles } from '../templates/uploaded-profiles';

/**
 * KYC v8 successor (RL Gym's request of 18 Nov 2026; owner's one-time migration exception APR-01). Three phases, each a
 * dry run by default, each audited (actor SYSTEM, `kyc-v8-successor`) with the Admin who asked for it, each idempotent:
 *
 * 1. `template`: creates v8 as a DRAFT successor version of the published v7 from the candidate spec RL Gym reviewed
 *    (the same lineage; v7 stays published and unchanged). The form is byte-identical, so it keeps its form ID (TS-24).
 *    A Praxis Admin publishes v8 in the console.
 * 2. `project`: on the published v8, a project that mirrors the v7 project (owner, JDs, dates, target, one task per
 *    application type), with the v7 project's policy documents copied byte for byte and the official text of
 *    31 CFR 1020.220 added as a project policy document. The v7 project's published rules are copied as DRAFT rules
 *    (project isolation: they are reviewed again here); the three rules the policy owner mapped to the regulation
 *    (APR-04) also cite its official text. A person reviews the rules and publishes the rule set in the console.
 * 3. `tasks`: once the rule set is published, one successor revision per approved v7 record arrives as submitted work:
 *    sections S1-S3 and S5-S8 carried verbatim from the approved record, S4 bound to the project's policy library (the
 *    official text, then the bank policy document the v7 task cited), with its lineage in the task input. The same
 *    checks an approval re-runs must pass. A person approves each task in the console, which writes the append-only
 *    approved record with that person's identity; nothing here writes or extends an approval.
 */

export const KYC_V8_DEFAULTS = {
  v7TemplateId: '40713870-6421-4d20-b727-eb862927ec72',
  v7ProjectId: 'f7f3cfae-d6a2-450b-9748-1485047ef4c3',
  /**
   * Approvals each successor revision carries by reference (owner's brief, 18 Nov 2026; package rev 2): the migration
   * exception, the rule-to-clause map, the S4 change, the S4 impact assessment and the approval to create v8 in QA.
   */
  approvalIds: ['APR-01', 'APR-04', 'APR-05', 'APR-11', 'APR-12'],
} as const;

const ACTOR = 'kyc-v8-successor';
const DATA = new URL('./kyc-v8/', import.meta.url);
const OFFICIAL_FILE = '31cfr1020.220-asof-2026-11-12.xml';
const SUCCESSOR_SCHEMA = 'adi-forge.successor-task-revision.v1';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// ───────────────────────── Inputs (embedded, from the package RL Gym reviewed) ─────────────────────────

export interface SuccessorCandidate {
  successor_of_record_id: string;
  successor_of_task_id: string;
  title: string;
  output: { header?: unknown; profile: { id: string; version: number }; sections: Record<string, Record<string, unknown>> };
}
export interface KycV8Inputs {
  spec: JointTemplateSpec;
  idMap: { title: string; v7_record_id: string; v7_task_id: string; v7_content_hash: string; successor_output_sha256: string }[];
  successors: Map<string, { candidate: SuccessorCandidate; fileSha256: string }>;
  approvals: { id: string; what?: string; decision?: string; approved_by?: string; approved_at?: string; status?: string; statement?: string }[];
  officialText: { fileName: string; bytes: Buffer; sha256: string };
}

/** Loads the embedded inputs (or another directory with the same layout). Every file is parsed as plain JSON. */
export function loadKycV8Inputs(dir: URL | string = DATA): KycV8Inputs {
  const base = typeof dir === 'string' ? new URL(`file://${dir.endsWith('/') ? dir : `${dir}/`}`) : dir;
  const json = (name: string) => JSON.parse(readFileSync(new URL(name, base), 'utf8')) as unknown;
  const spec = json('template-spec.json') as JointTemplateSpec;
  const idMap = (json('id-map.json') as { map: KycV8Inputs['idMap'] }).map;
  const successors = new Map<string, { candidate: SuccessorCandidate; fileSha256: string }>();
  for (const f of readdirSync(new URL('successors/', base)).filter((n) => n.endsWith('.json')).sort()) {
    const bytes = readFileSync(new URL(`successors/${f}`, base));
    const c = JSON.parse(bytes.toString('utf8')) as SuccessorCandidate;
    successors.set(c.successor_of_record_id, { candidate: c, fileSha256: sha256Hex(bytes) });
  }
  const approvals = (json('approval-records.json') as { records: KycV8Inputs['approvals'] }).records;
  const bytes = readFileSync(new URL(OFFICIAL_FILE, base));
  return { spec, idMap, successors, approvals, officialText: { fileName: OFFICIAL_FILE, bytes, sha256: sha256Hex(bytes) } };
}

async function requireAdmin(tx: Db | Tx, clientId: string, email: string) {
  return tx.user.findFirst({ where: { clientId, email: { equals: email, mode: 'insensitive' }, status: 'ACTIVE', roles: { has: 'ADMIN' } } });
}

const auditAs = (tx: Tx, clientId: string) => (a: AuditInput) => writeAudit(tx, { clientId, actorType: 'SYSTEM', actorId: ACTOR }, a);

// ───────────────────────── Phase 1: the v8 DRAFT ─────────────────────────

export interface TemplateReport {
  outcome: 'would_create' | 'created' | 'already_created' | 'refused';
  reason?: string;
  errors?: unknown[];
  v7?: { templateVersionId: string; templateId: string; version: number; template_sha256: string; part_hashes: Record<string, string> };
  v8?: { templateVersionId?: string; templateId: string; version: number; status?: string; template_sha256: string; part_hashes: Record<string, string> };
  formId?: string;
  formKept?: boolean;
  changedParts?: string[];
}

/** The proposal body of the candidate (Praxis assigns template_id and version, so they are checked, then left out). */
function proposalOf(spec: JointTemplateSpec) {
  const { template_id: _t, version: _v, ...body } = spec;
  void _t;
  void _v;
  return body as Record<string, unknown>;
}

export async function successorTemplate(db: Db, args: { v7TemplateId: string; requestedBy: string; apply: boolean; spec?: JointTemplateSpec }): Promise<TemplateReport> {
  await loadUploadedProfiles(db);
  const spec = args.spec ?? loadKycV8Inputs().spec;
  return db.$transaction(async (tx) => {
    const v7 = await tx.template.findUnique({ where: { id: args.v7TemplateId } });
    if (!v7) return { outcome: 'refused', reason: 'The v7 template version was not found.' };
    const v7Spec = jointTemplateSpec(v7);
    if (!v7Spec) return { outcome: 'refused', reason: 'The v7 template version has no joint template spec.' };
    const v7Hashes = jointHashes(v7Spec);
    const report: TemplateReport = { outcome: 'refused', v7: { templateVersionId: v7.id, templateId: v7.lineageId, version: v7.version, ...v7Hashes } };
    const refuse = (reason: string, errors?: unknown[]): TemplateReport => ({ ...report, outcome: 'refused', reason, ...(errors ? { errors } : {}) });
    if (v7.status !== 'PUBLISHED') return refuse('v7 must be published.');
    if (spec.schemaVersion !== JOINT_TEMPLATE_SPEC) return refuse(`The spec must be ${JOINT_TEMPLATE_SPEC}.`);
    if (spec.template_id !== v7.lineageId || spec.version !== v7.version + 1) return refuse(`The spec must be version ${v7.version + 1} of template ${v7.lineageId}.`);
    if (spec.anvil_template_key !== v7Spec.anvil_template_key) return refuse('The spec must keep the v7 anvil_template_key.');
    const succ = spec.requirement.successor_of as { template_id?: unknown; version?: unknown; template_sha256?: unknown } | undefined;
    if (!succ || succ.template_id !== v7.lineageId || succ.version !== v7.version || succ.template_sha256 !== v7Hashes.template_sha256) return refuse('requirement.successor_of must name v7 by template ID, version and its published template_sha256.');
    const formId = String(spec.authoring.profile.profileId);
    const formKept = jcsSha256(spec.authoring.profile) === jcsSha256(v7Spec.authoring.profile);
    const v8Hashes = jointHashes(spec);
    const changedParts = (['requirement', 'authoring', 'execution', 'skills'] as const).filter((k) => jcs(spec[k]) !== jcs(v7Spec[k]));
    Object.assign(report, { formId, formKept, changedParts, v8: { templateId: spec.template_id, version: spec.version, ...v8Hashes } });

    const existing = await tx.template.findFirst({ where: { lineageId: v7.lineageId, version: spec.version } });
    if (existing) {
      const same = (() => {
        const j = jointTemplateSpec(existing);
        return !!j && jcsSha256(j) === v8Hashes.template_sha256;
      })();
      if (!same) return refuse(`Version ${spec.version} already exists with different content; it is never overwritten.`);
      return { ...report, outcome: 'already_created', v8: { ...report.v8!, templateVersionId: existing.id, status: existing.status } };
    }
    const latest = await tx.template.findFirst({ where: { lineageId: v7.lineageId }, orderBy: { version: 'desc' } });
    if (latest?.id !== v7.id) return refuse(`Version ${latest?.version} is newer than v7.`);
    const admin = await requireAdmin(tx, v7.clientId, args.requestedBy);
    if (!admin) return refuse('The requester must be an active Admin of this client.');

    const body = proposalOf(spec);
    const r = await check(tx, v7.clientId, body);
    if (!r.valid || !r.joint) return refuse('The v8 spec does not pass the template proposal checks.', r.errors);
    if (!args.apply) return { ...report, outcome: 'would_create' };

    const audit = auditAs(tx, v7.clientId);
    const stored = await storePack(tx, { clientId: v7.clientId, uploaderId: admin.id, body: r.packBody, audit, anvilSpec: r.joint as unknown as Prisma.InputJsonValue, newVersionOfExisting: true, from: 'praxis_successor_version' });
    if (!stored.createdTemplateId) throw new Error('No draft version was created.');
    const authoringSkills = ((r.joint.skills.authoring as { mandatory?: string[] } | undefined)?.mandatory ?? []) as string[];
    const draft = await tx.template.update({ where: { id: stored.createdTemplateId }, data: { skills: [...new Set(authoringSkills)] } });
    // The stored version must hash exactly as the spec RL Gym reviewed; otherwise nothing is kept.
    const hash = templateVersionHash(draft);
    if (hash !== v8Hashes.template_sha256) throw new Error(`The created version hashes to ${hash}, not ${v8Hashes.template_sha256}; nothing was kept.`);
    await audit({
      entityType: 'Template',
      entityId: draft.id,
      action: 'template.successor_version_created',
      before: { templateId: v7.id, version: v7.version, template_sha256: v7Hashes.template_sha256 },
      after: { version: draft.version, status: draft.status, profileId: draft.profileId, formKept, changedParts, requestedBy: admin.id, approvals: ['APR-01'], ...v8Hashes },
    });
    return { ...report, outcome: 'created', v8: { ...report.v8!, templateVersionId: draft.id, status: draft.status } };
  });
}

// ───────────────────────── Phase 2: the v8 project and its policy ─────────────────────────

/**
 * The rules the policy owner mapped to 31 CFR 1020.220 (APR-04, 18 Nov 2026), with the clause and a verbatim quote of the
 * official text that the new citation resolves to. The reviewer checks each in the console.
 */
export const APR04_CLAUSES: Record<string, { clause: string; quote: string }> = {
  'R-COLLECT-CUSTOMER-NAME': { clause: '31 CFR 1020.220(a)(2)(i)(A)(1)', quote: 'the bank must obtain, at a minimum, the following information from the customer prior to opening an account' },
  'R-COLLECT-ADDRESS': { clause: '31 CFR 1020.220(a)(2)(i)(A)(3)', quote: 'Address, which shall be:' },
  'R-CONFIRM-PENDING-TIN-APPLICATION': { clause: '31 CFR 1020.220(a)(2)(i)(B)', quote: 'the CIP must include procedures to confirm that the application was filed before the customer opens the account' },
};

export const projectNameFor = (v7Name: string) => `${v7Name} (v8 successors)`.slice(0, 200);
const OFFICIAL_TITLE = '31 CFR 1020.220 Customer identification program requirements for banks (official text, eCFR as of 12 Nov 2026)';

export interface ProjectReport {
  outcome: 'would_create' | 'created' | 'already_created' | 'refused';
  reason?: string;
  v7Project?: { id: string; name: string; reviewRoute: string; ruleSetVersion: number | null };
  v8Project?: { id?: string; name: string; templateVersionId: string; version: number; tasks?: number };
  documents?: { title: string; sha256: string; from: 'v7_project' | 'official_text'; documentVersionId?: string }[];
  rules?: { ruleKey: string; state?: string; citesOfficialText: boolean }[];
}

async function v8Of(tx: Db | Tx, v7: Template) {
  return tx.template.findFirst({ where: { lineageId: v7.lineageId, version: v7.version + 1 } });
}

export async function successorProject(db: Db, deps: { storage: ObjectStorage }, args: { v7TemplateId: string; v7ProjectId: string; requestedBy: string; apply: boolean; inputs?: KycV8Inputs }): Promise<ProjectReport> {
  const inputs = args.inputs ?? loadKycV8Inputs();
  return db.$transaction(
    async (tx) => {
      const v7 = await tx.template.findUnique({ where: { id: args.v7TemplateId } });
      const p7 = await tx.project.findUnique({ where: { id: args.v7ProjectId }, include: { demographicFilters: true } });
      if (!v7 || !p7) return { outcome: 'refused', reason: 'The v7 template version or project was not found.' };
      const set7 = await tx.projectRuleSet.findFirst({ where: { projectId: p7.id }, orderBy: { version: 'desc' } });
      const report: ProjectReport = { outcome: 'refused', v7Project: { id: p7.id, name: p7.name, reviewRoute: p7.reviewRoute, ruleSetVersion: set7?.version ?? null } };
      const refuse = (reason: string): ProjectReport => ({ ...report, outcome: 'refused', reason });
      if (p7.templateId !== v7.id) return refuse('The v7 project is not on the v7 template version.');
      const v8 = await v8Of(tx, v7);
      if (!v8) return refuse('v8 does not exist yet; run the template phase first.');
      if (v8.status !== 'PUBLISHED') return refuse('v8 is not published yet; an Admin publishes it in the console first.');
      const federal = ((jointTemplateSpec(v8)?.execution.federalPolicies ?? []) as { id?: string; content_sha256?: string }[]).find((f) => f.content_sha256 === inputs.officialText.sha256);
      if (!federal) return refuse(`The official text file (sha256 ${inputs.officialText.sha256}) is not a federal policy v8 binds.`);
      if (!set7) return refuse('The v7 project has no published rule set to mirror.');
      const name = projectNameFor(p7.name);
      report.v8Project = { name, templateVersionId: v8.id, version: v8.version };

      const content7 = ProjectRuleSetContent.parse(set7.content);
      const dvIds = [...new Set(content7.rules.flatMap((r) => r.sources.map((s) => s.documentVersionId)))];
      const dvs7 = await tx.policyDocumentVersion.findMany({ where: { projectId: p7.id, id: { in: dvIds } }, include: { document: true }, orderBy: { createdAt: 'asc' } });
      report.documents = [...dvs7.map((d) => ({ title: d.document.title, sha256: d.sha256, from: 'v7_project' as const })), { title: OFFICIAL_TITLE, sha256: inputs.officialText.sha256, from: 'official_text' as const }];
      report.rules = content7.rules.map((r) => ({ ruleKey: r.ruleKey, citesOfficialText: r.ruleKey in APR04_CLAUSES }));
      const missing = Object.keys(APR04_CLAUSES).filter((k) => !content7.rules.some((r) => r.ruleKey === k));
      if (missing.length) return refuse(`The v7 rule set lacks the rules the policy owner mapped (APR-04): ${missing.join(', ')}.`);

      const existing = await tx.project.findFirst({ where: { clientId: p7.clientId, name } });
      if (existing) {
        if (existing.templateId !== v8.id) return refuse(`A project named "${name}" exists on another template version.`);
        return { ...report, outcome: 'already_created', v8Project: { ...report.v8Project, id: existing.id, tasks: await tx.taskInstance.count({ where: { projectId: existing.id } }) } };
      }
      const admin = await requireAdmin(tx, p7.clientId, args.requestedBy);
      if (!admin) return refuse('The requester must be an active Admin of this client.');
      if (!args.apply) return { ...report, outcome: 'would_create' };

      const audit = auditAs(tx, p7.clientId);
      const p8 = await createMirrorProject(tx, p7, v8, name);
      await audit({ entityType: 'Project', entityId: p8.id, action: 'project.successor_created', before: { projectId: p7.id, templateId: v7.id, version: v7.version }, after: { name, templateId: v8.id, version: v8.version, reviewRoute: p8.reviewRoute, requestedBy: admin.id, approvals: ['APR-01'] } });
      const tasks = await ensureSlotTasks(tx, p8.id);

      // Policy documents: the v7 project's, byte for byte, then the official text.
      const deps2 = { storage: deps.storage, scanner: stubScanner, maxPages: 200 };
      const copied = new Map<string, PolicyDocumentVersion>();
      for (const d of dvs7) {
        const buf = await deps.storage.get(d.storageKey);
        if (sha256Hex(buf) !== d.sha256) throw new Error(`Stored bytes of document version ${d.id} do not match its sha256.`);
        const added = await addDocumentVersion(tx, deps2, { clientId: p8.clientId, projectId: p8.id, actorId: admin.id, meta: metaOf(d.document), fileName: d.fileName, buf, origin: d.origin }, audit);
        copied.set(d.id, added.version);
      }
      const official = await addDocumentVersion(
        tx,
        deps2,
        { clientId: p8.clientId, projectId: p8.id, actorId: admin.id, meta: { title: OFFICIAL_TITLE, category: 'Federal regulation', language: 'en', jurisdiction: 'US', effectiveFrom: '2020-11-16' }, fileName: inputs.officialText.fileName, buf: inputs.officialText.bytes, origin: 'UPLOAD' },
        audit,
      );
      if (official.version.sha256 !== inputs.officialText.sha256) throw new Error('The official text changed while it was stored.');

      // Rules: the v7 project's published rules as DRAFTs on the copied documents; APR-04 rules also cite the official text.
      const texts = new Map<string, { text: string; pages: string[]; format: string }>();
      const textOf = async (v: PolicyDocumentVersion) => texts.get(v.id) ?? texts.set(v.id, { ...(await loadVersionText(deps.storage, v)), format: v.format }).get(v.id)!;
      const rules: NonNullable<ProjectReport['rules']> = [];
      for (const r of content7.rules) {
        const bySource = r.sources.map((s) => ({ s, dv: copied.get(s.documentVersionId)! }));
        const first = bySource[0]?.dv;
        if (!first) throw new Error(`Rule ${r.ruleKey} has no source document.`);
        const cite = (s: (typeof r.sources)[number]) => CandidateCitation.parse({ fieldPath: s.fieldPath, role: s.role, quote: s.quote });
        const created = await createRuleFromCandidate(tx, {
          clientId: p8.clientId,
          projectId: p8.id,
          documentVersion: first,
          doc: await textOf(first),
          candidate: { ...PolicyRuleBody.parse(r.body), ruleKey: r.ruleKey, citations: bySource.filter((x) => x.dv.id === first.id).map((x) => cite(x.s)) },
          origin: 'successor_copy',
          editedById: admin.id,
          ruleKey: r.ruleKey,
          annotationSave: { source: 'AUTHOR_EDIT', editedById: admin.id },
        });
        const extra = [...bySource.filter((x) => x.dv.id !== first.id).map((x) => ({ dv: x.dv, c: cite(x.s) }))];
        const clause = APR04_CLAUSES[r.ruleKey];
        if (clause) extra.push({ dv: official.version, c: CandidateCitation.parse({ fieldPath: 'requirement', role: 'supports', quote: clause.quote }) });
        for (const e of extra) {
          const res = resolveCitation(e.c, await textOf(e.dv));
          await tx.policyCitation.create({ data: { clientId: p8.clientId, ruleVersionId: created.version.id, documentVersionId: e.dv.id, fieldPath: e.c.fieldPath, role: e.c.role, quote: res.quote, locator: res.locator as unknown as Prisma.InputJsonValue, resolution: res.resolution, providerRaw: { copiedFrom: r.ruleVersionId, ...(clause && e.dv.id === official.version.id ? { clause: clause.clause, approval: 'APR-04' } : {}) } as Prisma.InputJsonValue } });
        }
        if (extra.length) {
          const all = await tx.policyCitation.findMany({ where: { ruleVersionId: created.version.id } });
          await tx.policyRuleVersion.update({ where: { id: created.version.id }, data: { contentHash: ruleContentHash(PolicyRuleBody.parse(created.version.body), all) } });
        }
        await audit({ entityType: 'PolicyRuleVersion', entityId: created.version.id, action: 'policy.rule_copied_for_successor', after: { ruleKey: r.ruleKey, fromRuleVersionId: r.ruleVersionId, fromRuleSetVersion: set7.version, state: created.version.state, citesOfficialText: !!clause, ...(clause ? { clause: clause.clause, approval: 'APR-04' } : {}) } });
        rules.push({ ruleKey: r.ruleKey, state: created.version.state, citesOfficialText: !!clause });
      }
      return {
        ...report,
        outcome: 'created',
        v8Project: { ...report.v8Project, id: p8.id, tasks },
        documents: [...dvs7.map((d) => ({ title: d.document.title, sha256: d.sha256, from: 'v7_project' as const, documentVersionId: copied.get(d.id)!.id })), { title: OFFICIAL_TITLE, sha256: official.version.sha256, from: 'official_text' as const, documentVersionId: official.version.id }],
        rules,
      };
    },
    { timeout: 120_000 },
  );
}

const metaOf = (d: PolicyDocument) => ({ title: d.title, category: d.category, language: d.language, jurisdiction: d.jurisdiction, effectiveFrom: d.effectiveFrom?.toISOString().slice(0, 10) ?? null, effectiveTo: d.effectiveTo?.toISOString().slice(0, 10) ?? null });

/**
 * The v8 project: the v7 project's settings (owner, JDs, dates, target, demographic filters) on v8. Two settings differ
 * by decision (docs/DECISIONS.md, 18 Nov 2026): the review route is SME -> PM/Admin, so the console approval is the
 * human decision, and no authoring experience is set, since nobody authors here (content arrives as submitted work).
 */
async function createMirrorProject(tx: Tx, p7: Project & { demographicFilters: ProjectDemographicFilter[] }, v8: Template, name: string) {
  const p8 = await tx.project.create({
    data: {
      clientId: p7.clientId,
      ownerId: p7.ownerId,
      templateId: v8.id,
      templateVersion: v8.version,
      jobDescriptionId: p7.jobDescriptionId,
      jdSnapshotId: p7.jdSnapshotId,
      reviewerJobDescriptionId: p7.reviewerJobDescriptionId,
      ...(p7.reviewerJdSnapshot !== null ? { reviewerJdSnapshot: p7.reviewerJdSnapshot as Prisma.InputJsonValue } : {}),
      jdGenerated: p7.jdGenerated,
      name,
      description: `Successor revisions of the approved tasks of "${p7.name}" on template version ${v8.version}.`,
      status: 'IN_PROGRESS',
      authoringExperience: null,
      reviewRoute: 'SME_PM',
      taskMode: p7.taskMode,
      taskCount: p7.taskCount,
      distinctTarget: p7.distinctTarget,
      maxPerExpert: p7.maxPerExpert,
      openSlotShare: p7.openSlotShare,
      ...(p7.coverageQuotas !== null ? { coverageQuotas: p7.coverageQuotas as Prisma.InputJsonValue } : {}),
      tptMinutes: p7.tptMinutes,
      hoursPerWorkerDay: p7.hoursPerWorkerDay,
      startDate: p7.startDate,
      endDate: p7.endDate,
      requiredWorkers: p7.requiredWorkers,
      ...(p7.figures !== null ? { figures: p7.figures as Prisma.InputJsonValue } : {}),
      ...(p7.demographicsSnapshot !== null ? { demographicsSnapshot: p7.demographicsSnapshot as Prisma.InputJsonValue } : {}),
      openTaskCapPerCandidate: p7.openTaskCapPerCandidate,
      submittedAt: new Date(),
    },
  });
  for (const f of p7.demographicFilters) await tx.projectDemographicFilter.create({ data: { clientId: p7.clientId, projectId: p8.id, attributeKey: f.attributeKey, operator: f.operator, values: f.values as Prisma.InputJsonValue, required: f.required } });
  return p8;
}

// ───────────────────────── Phase 3: the successor task revisions ─────────────────────────

export interface TaskReport {
  title: string;
  predecessorRecordId: string;
  outcome: 'would_create' | 'created' | 'already_created' | 'refused';
  reason?: string;
  taskId?: string;
  successorOutputSha256?: string;
  s4?: unknown[];
  failing?: { id: string; section: string; message: string }[];
}
export interface TasksReport {
  outcome: 'ok' | 'refused';
  reason?: string;
  projectId?: string;
  ruleSetVersion?: number;
  tasks: TaskReport[];
}

const S4_ITEM_PRIVATE = ['appliesTo', 'rationale', 'exception'] as const;

/** One S4 policy reference, as the project policy library identifies a published document (PR #81 mapping). */
function s4Item(d: LibraryDocument, from: Record<string, unknown> | undefined) {
  const item: Record<string, unknown> = { ruleId: d.policyId, ruleVersion: d.version, locator: d.publicationRef, contentSha256: d.sha256 };
  for (const k of S4_ITEM_PRIVATE) item[k] = typeof from?.[k] === 'string' ? from[k] : '';
  return item;
}

/**
 * The successor's S4 in the form's own field (the form is unchanged, so it has no other place): the official text
 * first, then each policy document the predecessor cited, both identified from this project's published library.
 * Private applicability notes come from the candidate's S4 and the predecessor's entries.
 */
export function successorS4(args: { predecessorS4: Record<string, unknown>; candidateS4: Record<string, unknown>; library: LibraryDocument[]; officialSha256: string }): { S4: Record<string, unknown>; problems: string[] } | { problems: string[] } {
  const problems: string[] = [];
  const official = args.library.find((d) => d.sha256 === args.officialSha256);
  if (!official) problems.push('The official text is not a published document of this project’s rule set.');
  const prior = (Array.isArray(args.predecessorS4.statePolicies) ? args.predecessorS4.statePolicies : []).filter(isObj);
  const bank = prior.map((p) => ({ p, d: args.library.find((d) => d.sha256 === p.contentSha256) }));
  for (const b of bank) if (!b.d) problems.push(`The policy document the v7 task cited (sha256 ${String(b.p.contentSha256)}) is not published in this project.`);
  if (problems.length) return { problems };
  const candOfficial = (Array.isArray(args.candidateS4.statePolicies) ? args.candidateS4.statePolicies : []).filter(isObj).find((x) => x.contentSha256 === args.officialSha256);
  return { S4: { ...args.predecessorS4, statePolicies: [s4Item(official!, candOfficial), ...bank.map((b) => s4Item(b.d!, b.p))] }, problems: [] };
}

export async function successorTasks(db: Db, args: { v7TemplateId: string; v7ProjectId: string; requestedBy: string; apply: boolean; inputs?: KycV8Inputs; approvalIds?: readonly string[] }): Promise<TasksReport> {
  const inputs = args.inputs ?? loadKycV8Inputs();
  const approvalIds = args.approvalIds ?? KYC_V8_DEFAULTS.approvalIds;
  await loadUploadedProfiles(db);
  return db.$transaction(
    async (tx) => {
      const v7 = await tx.template.findUnique({ where: { id: args.v7TemplateId } });
      const p7 = await tx.project.findUnique({ where: { id: args.v7ProjectId } });
      if (!v7 || !p7) return { outcome: 'refused', reason: 'The v7 template version or project was not found.', tasks: [] };
      const v8 = await v8Of(tx, v7);
      const p8 = v8 ? await tx.project.findFirst({ where: { clientId: p7.clientId, name: projectNameFor(p7.name), templateId: v8.id } }) : null;
      if (!v8 || v8.status !== 'PUBLISHED' || !p8) return { outcome: 'refused', reason: 'Run the template and project phases first (v8 published, v8 project created).', tasks: [] };
      const lib = await policyLibrary(tx, p8.clientId, p8.id);
      if (lib.setVersion === null) return { outcome: 'refused', reason: 'The v8 project has no published rule set yet: review its rules and publish the rule set in the console first.', projectId: p8.id, tasks: [] };
      const admin = await requireAdmin(tx, p7.clientId, args.requestedBy);
      if (!admin) return { outcome: 'refused', reason: 'The requester must be an active Admin of this client.', projectId: p8.id, tasks: [] };
      const approvals = approvalIds.map((id) => inputs.approvals.find((a) => a.id === id) ?? null);
      const missingApprovals = approvalIds.filter((_, i) => !approvals[i]);
      if (missingApprovals.length) return { outcome: 'refused', reason: `The approval records lack ${missingApprovals.join(', ')}; every approval a successor carries must be recorded.`, projectId: p8.id, tasks: [] };
      const audit = auditAs(tx, p8.clientId);
      const tasks: TaskReport[] = [];

      for (const m of inputs.idMap) {
        const out: TaskReport = { title: m.title, predecessorRecordId: m.v7_record_id, outcome: 'refused' };
        tasks.push(out);
        const rec = await tx.approvedTaskRecord.findUnique({ where: { id: m.v7_record_id } });
        const cand = inputs.successors.get(m.v7_record_id);
        const prior = await tx.taskInstance.findFirst({ where: { projectId: p8.id, input: { path: ['successorOf', 'predecessor', 'recordId'], equals: m.v7_record_id } } });
        if (prior) {
          Object.assign(out, { outcome: 'already_created', taskId: prior.id });
          continue;
        }
        const refusal = await predecessorProblem(tx, rec, cand?.candidate, { m, p7, v7 });
        if (refusal) {
          out.reason = refusal;
          continue;
        }
        const r = rec!;
        const c = cand!.candidate;
        const authored = authoredContent(r.output) as Record<string, unknown> & { sections: Record<string, Record<string, unknown>> };
        const s4 = successorS4({ predecessorS4: authored.sections.S4 ?? {}, candidateS4: c.output.sections.S4 ?? {}, library: lib.documents, officialSha256: inputs.officialText.sha256 });
        if (!('S4' in s4)) {
          out.reason = s4.problems.join(' ');
          continue;
        }
        const output = { ...authored, sections: { ...authored.sections, S4: s4.S4 } };
        out.s4 = s4.S4.statePolicies as unknown[];
        out.successorOutputSha256 = jcsSha256(output);

        // The project's CREATED task for the same application type (one per slot).
        const value = (r.input as { slot?: { case?: { value?: string } } }).slot?.case?.value;
        const task = (await tx.taskInstance.findMany({ where: { projectId: p8.id, status: 'CREATED', assignedToId: null }, include: { slot: true } })).find((t) => (t.input as { slot?: { case?: { value?: string } } }).slot?.case?.value === value);
        if (!task) {
          out.reason = `The v8 project has no open task for application type "${String(value)}".`;
          continue;
        }
        const candidate = await tx.candidate.findUniqueOrThrow({ where: { id: r.candidateId } });
        const successorOf = {
          schema: SUCCESSOR_SCHEMA,
          predecessor: { recordId: r.id, taskId: r.taskInstanceId, projectId: r.projectId, templateId: r.templateId, templateVersion: r.templateVersion, contentHash: r.contentHash, candidateId: r.candidateId, smeUserId: candidate.smeUserId, submittedAt: r.submittedAt.toISOString(), reviewerId: r.reviewerId, reviewDecisionAt: r.reviewDecisionAt.toISOString() },
          carriedSections: Object.keys(authored.sections).filter((k) => k !== 'S4').sort(),
          changedSections: ['S4'],
          approvals: approvalIds.map((id, i) => ({ id, what: approvals[i]!.what ?? null, ...(approvals[i]!.decision ? { decision: approvals[i]!.decision } : {}), approvedAt: approvals[i]!.approved_at ?? null, status: approvals[i]!.status ?? null })),
          candidate: { fileSha256: cand!.fileSha256, outputSha256: m.successor_output_sha256 },
          s4Binding: 'S4 cites the v8 project policy library (official 31 CFR 1020.220 text, then the bank policy document the predecessor cited); same content hashes as the candidate',
          note: 'One-time successor migration (APR-01). The predecessor’s approval is not extended: a person approves this revision.',
        };
        const input = { ...(task.input as Record<string, unknown>), successorOf };
        const options = checkOptions((await tx.taskInstance.findUnique({ where: { id: r.taskInstanceId }, select: { checks: true } }))?.checks ?? null);
        const compiled = compileForSubmission(v8, output, { taskId: task.id, revisionId: `${task.id}-r${task.revision + 1}` });
        const stored = (compiled?.output ?? output) as Prisma.InputJsonValue;
        // The checks the console approval re-runs (D18) must pass now; author attestations stay with the predecessor.
        const rv = await revalidateTask(tx, { ...task, input: input as Prisma.JsonValue, output: stored as Prisma.JsonValue, project: { template: v8 }, checks: { results: [], keyInputs: [], similar: [], embeddingModel: null, options } as unknown as Prisma.JsonValue });
        if (rv.failing.length) {
          Object.assign(out, { reason: 'The successor does not pass the checks its approval re-runs.', failing: rv.failing.map((f) => ({ id: f.id, section: f.section, message: f.message })) });
          continue;
        }
        if (!args.apply) {
          Object.assign(out, { outcome: 'would_create', taskId: task.id });
          continue;
        }
        const now = new Date();
        const checks: StoredChecks = { results: rv.checks, keyInputs: [], similar: [], embeddingModel: null, ...(compiled ? { export: compiled.status } : {}), options };
        const { count } = await tx.taskInstance.updateMany({
          where: { id: task.id, revision: task.revision, status: 'CREATED' },
          data: { status: 'SUBMITTED', input: input as Prisma.InputJsonValue, output: stored, assignedToId: r.candidateId, assignedAt: now, submittedAt: now, coverageTags: (r.coverageTags ?? undefined) as Prisma.InputJsonValue | undefined, checks: checks as unknown as Prisma.InputJsonValue, flags: [] as Prisma.InputJsonValue, revision: { increment: 1 }, reviewStage: null },
        });
        if (!count) throw new Error(`Task ${task.id} changed while the successor was created.`);
        if (task.slotId) await tx.coverageSlot.update({ where: { id: task.slotId }, data: { status: 'IN_PROGRESS', assignedToId: r.candidateId } });
        const policy = await snapshotTask(tx, { clientId: p8.clientId, task: { id: task.id, projectId: p8.id }, actorId: ACTOR });
        await tx.taskSubmission.create({ data: { clientId: p8.clientId, taskInstanceId: task.id, version: 1, policySnapshotId: policy?.snapshot.id ?? null, output: stored, coverageTags: (r.coverageTags ?? undefined) as Prisma.InputJsonValue | undefined, checks: checks as unknown as Prisma.InputJsonValue } });
        await audit({ entityType: 'TaskInstance', entityId: task.id, action: 'task.successor_submitted', before: { status: 'CREATED', predecessorRecordId: r.id }, after: { status: 'SUBMITTED', version: 1, requestedBy: admin.id, carriedSections: successorOf.carriedSections, changedSections: ['S4'], successorOutputSha256: out.successorOutputSha256, approvals: approvalIds } });
        await emitEvent(tx, p8.clientId, { name: 'task.submitted', aggregateType: 'TaskInstance', aggregateId: task.id, payload: { taskId: task.id, projectId: p8.id, version: 1, flaggedDuplicate: false } });
        Object.assign(out, { outcome: 'created', taskId: task.id });
      }
      return { outcome: tasks.some((t) => t.outcome === 'refused') ? 'refused' : 'ok', projectId: p8.id, ruleSetVersion: lib.setVersion, tasks };
    },
    { timeout: 120_000 },
  );
}

/** Why a predecessor cannot get a successor (null when it can): it must be the current approved v7 record, unchanged. */
async function predecessorProblem(tx: Tx, rec: ApprovedTaskRecord | null, cand: SuccessorCandidate | undefined, ctx: { m: KycV8Inputs['idMap'][number]; p7: Project; v7: Template }): Promise<string | null> {
  if (!rec) return 'The v7 approved record was not found.';
  if (rec.projectId !== ctx.p7.id || rec.templateId !== ctx.v7.id) return 'The record is not an approved task of the v7 project.';
  if (rec.taskInstanceId !== ctx.m.v7_task_id || rec.contentHash !== ctx.m.v7_content_hash) return 'The record differs from the one in the ID map (task or content hash).';
  if (await tx.approvedTaskRecord.count({ where: { supersedesId: rec.id } })) return 'The record has been superseded.';
  const later = await tx.approvedTaskRecord.findFirst({ where: { taskInstanceId: rec.taskInstanceId, seq: { gt: rec.seq } } });
  if (later) return 'The v7 task has a later approved record; map that one instead.';
  if (!cand) return 'No successor candidate for this record.';
  if (cand.successor_of_record_id !== rec.id || cand.successor_of_task_id !== rec.taskInstanceId) return 'The successor candidate names another predecessor.';
  const authored = authoredContent(rec.output) as { profile?: unknown; header?: unknown; sections?: Record<string, unknown> };
  if (jcs(authored.profile) !== jcs(cand.output.profile)) return 'The successor candidate is on another form.';
  const keys = new Set([...Object.keys(authored.sections ?? {}), ...Object.keys(cand.output.sections)]);
  const changed = [...keys].filter((k) => k !== 'S4' && jcs(authored.sections?.[k] ?? null) !== jcs(cand.output.sections[k] ?? null));
  if (changed.length) return `The successor candidate changes ${changed.join(', ')}; only S4 may change.`;
  return null;
}

// ───────────────────────── Command line ─────────────────────────

export type KycV8Phase = 'template' | 'project' | 'tasks';
export interface KycV8Args {
  phase: KycV8Phase;
  requestedBy: string;
  apply: boolean;
  v7TemplateId: string;
  v7ProjectId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const KYC_V8_USAGE = 'Use: kyc-v8-successor template|project|tasks --requested-by <admin email> [--apply] [--v7-template <id>] [--v7-project <id>]';

/** `kyc-v8-successor <phase> --requested-by <admin email> [--apply] [--v7-template <id>] [--v7-project <id>]`. */
export function parseKycV8Args(argv: string[]): KycV8Args {
  const [phase, ...rest] = argv;
  if (phase !== 'template' && phase !== 'project' && phase !== 'tasks') throw new Error(KYC_V8_USAGE);
  const out: KycV8Args = { phase, requestedBy: '', apply: false, v7TemplateId: KYC_V8_DEFAULTS.v7TemplateId, v7ProjectId: KYC_V8_DEFAULTS.v7ProjectId };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    const value = () => {
      const v = rest[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value. ${KYC_V8_USAGE}`);
      return v;
    };
    if (a === '--apply') out.apply = true;
    else if (a === '--requested-by') out.requestedBy = value();
    else if (a === '--v7-template') out.v7TemplateId = value();
    else if (a === '--v7-project') out.v7ProjectId = value();
    else throw new Error(`Unknown argument "${a}". ${KYC_V8_USAGE}`);
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(out.requestedBy)) throw new Error(`--requested-by <admin email> is required. ${KYC_V8_USAGE}`);
  if (!UUID.test(out.v7TemplateId) || !UUID.test(out.v7ProjectId)) throw new Error(`IDs must be UUIDs. ${KYC_V8_USAGE}`);
  return out;
}
