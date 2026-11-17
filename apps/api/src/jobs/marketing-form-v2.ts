import { MARKETING_T2_PROFILE_ID, MARKETING_T2_PROFILE_ID_V2, withDeclaredCitationVisibility, type TemplateProfile } from '@praxis/shared';
import type { Prisma } from '@prisma/client';
import { jcsSha256 } from '../anvil/jcs';
import { jointParts, JOINT_TEMPLATE_SPEC } from '../anvil/joint-template';
import type { Db } from '../db';
import { writeAudit } from '../platform/audit';
import { check } from '../routes/anvil-templates';
import { storePack } from '../templates/golden-pack-store';
import { loadUploadedProfiles } from '../templates/uploaded-profiles';

/**
 * D26 follow-up (owner, 17 Nov 2026: "ok, do the new Marketing template version too"). The published VEYRA Hush One
 * form (`veyra-hush-one-launch-v1`) does not declare its S4 policy citations' sub-field visibility, so RL Gym's
 * projection would show the agent the private applies-to, rationale and exception text and the generic package refuses
 * every Marketing task (GENERIC_PRIVATE_EXPOSURE; four confirmations, still-incompatible item 2).
 *
 * RL Gym cannot send proposals to this environment yet, so this job builds the next version from the published one:
 * the same joint parts verbatim (anvil_template_key, requirement, execution, skills, template block), with only the form
 * replaced by `veyra-hush-one-launch-v2` (v1 plus the declared citation visibility; worked examples re-pointed to v2).
 * It runs the exact checks of an RL Gym proposal and creates a DRAFT version through the same path. A Praxis Admin
 * publishes it in the console; nothing goes live here. Dry run by default; audited (actor SYSTEM, `marketing-form-v2`)
 * with the Admin who asked for it.
 */
export interface FormV2Report {
  outcome: 'would_create' | 'created' | 'refused';
  reason?: string;
  source?: { templateId: string; workflow: string; version: number; profileId: string };
  draft?: { templateId: string; version: number; profileId: string };
  /** What differs between the published form and the new one (paths), and the parts that stay byte-identical. */
  formChanges?: string[];
  unchangedParts?: { execution: string; skills: string; requirement: string };
  errors?: unknown[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The S4 citation fields whose visibility v2 declares (for the report). */
function formChanges(v1: TemplateProfile, v2: TemplateProfile): string[] {
  const out = [`profileId: ${v1.profileId} -> ${v2.profileId}`];
  for (const s of v2.sections)
    for (const f of s.fields)
      if (f.type === 'policy_citation' && f.itemFields) out.push(`${s.key}.${f.key}.itemFields: ${f.itemFields.map((x) => `${x.key}${x.visibility && x.visibility !== 'author_and_agent' ? ' (private)' : ''}`).join(', ')}`);
  return out;
}

/** The proposal body for v2, from the published v1 version's stored joint parts. */
export function v2Proposal(anvilSpec: unknown): { body: Record<string, unknown>; v1: TemplateProfile; v2: TemplateProfile } | { reason: string } {
  const parts = jointParts({ anvilSpec } as never);
  if (!parts) return { reason: 'The template version has no RL Gym joint template spec.' };
  const v1 = parts.authoring.profile as unknown as TemplateProfile;
  if (v1.profileId !== MARKETING_T2_PROFILE_ID) return { reason: `The template version uses form ${String(v1.profileId)}, not ${MARKETING_T2_PROFILE_ID}.` };
  const v2 = withDeclaredCitationVisibility(v1, MARKETING_T2_PROFILE_ID_V2);
  const examples = (parts.authoring.examples ?? []).map((e) => {
    if (!isObj(e) || !isObj(e.output) || !isObj(e.output.profile) || e.output.profile.id !== MARKETING_T2_PROFILE_ID) return e;
    return { ...e, output: { ...e.output, profile: { ...e.output.profile, id: MARKETING_T2_PROFILE_ID_V2 } } };
  });
  const authoring = { ...parts.authoring, profile: v2 as unknown as Record<string, unknown>, ...(parts.authoring.examples !== undefined ? { examples } : {}) };
  const body = { schemaVersion: JOINT_TEMPLATE_SPEC, anvil_template_key: parts.anvil_template_key, requirement: parts.requirement, authoring, execution: parts.execution, skills: parts.skills };
  return { body, v1, v2 };
}

export async function marketingFormV2(db: Db, args: { templateId: string; requestedBy: string; apply: boolean }): Promise<FormV2Report> {
  await loadUploadedProfiles(db);
  return db.$transaction(async (tx) => {
    const t = await tx.template.findUnique({ where: { id: args.templateId } });
    if (!t) return { outcome: 'refused', reason: 'Template version not found.' };
    const source = { templateId: t.id, workflow: t.workflowName, version: t.version, profileId: String(t.profileId) };
    const refuse = (reason: string, errors?: unknown[]): FormV2Report => ({ outcome: 'refused', reason, source, ...(errors ? { errors } : {}) });
    if (t.status !== 'PUBLISHED') return refuse('Only a published version is revised.');
    const latest = await tx.template.findFirst({ where: { lineageId: t.lineageId }, orderBy: { version: 'desc' } });
    if (latest?.id !== t.id) return refuse(`Version ${latest?.version} is newer; revise the latest version only.`);
    const admin = await tx.user.findFirst({ where: { clientId: t.clientId, email: { equals: args.requestedBy, mode: 'insensitive' }, status: 'ACTIVE', roles: { has: 'ADMIN' } } });
    if (!admin) return refuse('The requester must be an active Admin of this client.');
    const p = v2Proposal(t.anvilSpec);
    if ('reason' in p) return refuse(p.reason);
    const r = await check(tx, t.clientId, p.body);
    if (!r.valid || !r.joint) return refuse('The new version does not pass the proposal checks.', r.errors);
    const parts = p.body as { requirement: unknown; execution: unknown; skills: unknown };
    const unchangedParts = { execution: jcsSha256(parts.execution), skills: jcsSha256(parts.skills), requirement: jcsSha256(parts.requirement) };
    const report = { source, formChanges: formChanges(p.v1, p.v2), unchangedParts };
    if (!args.apply) return { outcome: 'would_create', ...report };

    const audit = (a: Parameters<typeof writeAudit>[2]) => writeAudit(tx, { clientId: t.clientId, actorType: 'SYSTEM', actorId: 'marketing-form-v2' }, a);
    const stored = await storePack(tx, { clientId: t.clientId, uploaderId: admin.id, body: r.packBody, audit, anvilSpec: r.joint as unknown as Prisma.InputJsonValue, newVersionOfExisting: true, from: 'praxis_form_revision' });
    if (!stored.createdTemplateId) return refuse('No draft version was created.');
    const draft = await tx.template.findUniqueOrThrow({ where: { id: stored.createdTemplateId } });
    await audit({ entityType: 'Template', entityId: draft.id, action: 'template.form_revised', before: { templateId: t.id, version: t.version, profileId: t.profileId }, after: { version: draft.version, status: draft.status, profileId: draft.profileId, requestedBy: admin.id, reason: 'D26: declare S4 policy citation sub-field visibility for RL Gym', ...unchangedParts } });
    return { outcome: 'created', ...report, draft: { templateId: draft.id, version: draft.version, profileId: String(draft.profileId) } };
  });
}
