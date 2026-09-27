import type { Prisma } from '@prisma/client';
import type { DemographicFilterInput, MatchesResponse, MatchItemDto } from '@praxis/shared';
import type { Db, Tx } from '../db';
import type { OutboxInput } from '../outbox/outbox';
import type { AuditInput } from '../platform/audit';
import { normalizeTitle } from '../routes/job-descriptions';
import type { MatchRequest, MatchService } from './match-service';

/** How many ranked matches are stored per run (assigned candidates are always kept). */
export const STORED_MATCH_LIMIT = 500;

/**
 * FLOW 2 step 1 (decided 26 Sep 2026): keep the project's JD if it still exists; otherwise reuse an existing JD
 * with the same normalised title and skills, else create one from the project's frozen JD snapshot.
 * Returns the JD id and whether the link changed.
 */
export async function ensureJobDescription(tx: Tx, projectId: string): Promise<{ jobDescriptionId: string; changed: 'kept' | 'linked' | 'created' }> {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: { jobDescription: true, jdSnapshot: true } });
  if (p.jobDescription) return { jobDescriptionId: p.jobDescription.id, changed: 'kept' };
  if (!p.jdSnapshot) throw new Error(`Project ${projectId} has neither a JD nor a JD snapshot`);

  const snap = p.jdSnapshot.data as {
    title: string;
    responsibilities: string;
    skills: string[];
    wagePerTask: number;
    wageCurrency: string;
    locationType: 'REMOTE' | 'ONSITE' | 'HYBRID';
    location: string | null;
  };
  const sameSkills = (a: string[], b: string[]) =>
    a.length === b.length && [...a].map((s) => s.toLowerCase()).sort().join('|') === [...b].map((s) => s.toLowerCase()).sort().join('|');
  const candidates = await tx.jobDescription.findMany({ where: { clientId: p.clientId, normalizedTitle: normalizeTitle(snap.title) }, orderBy: { createdAt: 'asc' } });
  const existing = candidates.find((jd) => sameSkills(jd.skills, snap.skills));

  const jd =
    existing ??
    (await tx.jobDescription.create({
      data: {
        clientId: p.clientId,
        title: snap.title,
        normalizedTitle: normalizeTitle(snap.title),
        responsibilities: snap.responsibilities,
        skills: snap.skills,
        wagePerTask: snap.wagePerTask,
        wageCurrency: snap.wageCurrency,
        locationType: snap.locationType,
        location: snap.location,
      },
    }));
  await tx.project.update({ where: { id: p.id }, data: { jobDescriptionId: jd.id } });
  return { jobDescriptionId: jd.id, changed: existing ? 'linked' : 'created' };
}

/** Builds the matcher's input from the project as submitted (frozen demographics, template skills, JD skills). */
export async function matchRequestFor(tx: Db | Tx, projectId: string, onlyCandidateIds?: string[]): Promise<MatchRequest> {
  const p = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { template: true, jobDescription: true, demographicFilters: true },
  });
  const attributes = await tx.demographicAttribute.findMany({ where: { clientId: p.clientId }, select: { key: true, label: true, type: true } });
  return {
    projectId: p.id,
    clientId: p.clientId,
    templateSkills: p.template.skills,
    jdSkills: p.jobDescription?.skills ?? [],
    filters: p.demographicFilters.map((f) => ({ attributeKey: f.attributeKey, operator: f.operator, values: f.values, required: f.required }) as DemographicFilterInput),
    attributes,
    onlyCandidateIds,
  };
}

/** Runs the matcher and replaces the project's stored results. */
export async function runAndStoreMatches(tx: Tx, matcher: MatchService, projectId: string) {
  const req = await matchRequestFor(tx, projectId);
  const run = await matcher.findMatches(req);
  const assigned = new Set(
    (await tx.projectAssignment.findMany({ where: { projectId, releasedAt: null }, select: { candidateId: true } })).map((a) => a.candidateId),
  );
  const keep = run.matches.filter((m, i) => i < STORED_MATCH_LIMIT || assigned.has(m.candidateId));
  const computedAt = new Date();

  await tx.projectMatch.deleteMany({ where: { projectId } });
  await tx.projectMatch.createMany({
    data: keep.map((m, i) => ({
      clientId: req.clientId,
      projectId,
      candidateId: m.candidateId,
      rank: i + 1,
      score: m.score,
      breakdown: m.breakdown as unknown as Prisma.InputJsonValue,
      computedAt,
    })),
  });
  await tx.project.update({ where: { id: projectId }, data: { matchedAt: computedAt } });
  return { total: run.matches.length, stored: keep.length, warnings: run.warnings };
}

/** Proposals past their deadline expire and free their slot (FLOW2 C08). Applied lazily wherever staffing is read. */
export async function expireProposals(tx: Db | Tx, where: { projectId?: string; smeUserId?: string }) {
  const stale = await tx.smeAssignment.findMany({ where: { ...where, status: 'PROPOSED', expiresAt: { lt: new Date() } }, include: { projectAssignment: true } });
  for (const a of stale) {
    await tx.smeAssignment.update({ where: { id: a.id }, data: { status: 'EXPIRED', respondedAt: new Date() } });
    if (a.projectAssignment && !a.projectAssignment.releasedAt) await tx.projectAssignment.update({ where: { id: a.projectAssignment.id }, data: { releasedAt: new Date() } });
    await tx.auditEvent.create({ data: { clientId: a.clientId, actorType: 'SYSTEM', actorId: 'assignment-expiry', entityType: 'SmeAssignment', entityId: a.id, action: 'assignment.expired', before: { status: 'PROPOSED' }, after: { status: 'EXPIRED' } } });
  }
  return stale.length;
}

/**
 * Active assignments split by state. Accepted (or direct, from the staffing test double) count towards STAFFED;
 * proposals reserve a slot until answered.
 */
export async function assignmentCounts(tx: Db | Tx, projectId: string) {
  const active = await tx.projectAssignment.findMany({ where: { projectId, releasedAt: null }, include: { smeAssignment: true } });
  const accepted = active.filter((a) => !a.smeAssignment || a.smeAssignment.status === 'ACCEPTED' || a.smeAssignment.status === 'HANDED_OFF');
  const proposed = active.filter((a) => a.smeAssignment?.status === 'PROPOSED');
  return { active, accepted: accepted.length, proposed: proposed.length };
}

/** The Resource Assignment screen's data: header counts plus stored ranked matches. */
export async function listMatches(db: Db | Tx, projectId: string, warnings: string[] = []): Promise<MatchesResponse & { warnings: string[] }> {
  await expireProposals(db, { projectId });
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const [rows, assignments] = await Promise.all([
    db.projectMatch.findMany({
      where: { projectId },
      orderBy: { rank: 'asc' },
      include: { candidate: { include: { smeUser: { select: { displayName: true } } } } },
    }),
    db.projectAssignment.findMany({ where: { projectId, releasedAt: null }, include: { smeAssignment: true } }),
  ]);
  const byCandidate = new Map(assignments.map((a) => [a.candidateId, a]));
  const accepted = assignments.filter((a) => !a.smeAssignment || ['ACCEPTED', 'HANDED_OFF'].includes(a.smeAssignment.status)).length;
  const proposed = assignments.filter((a) => a.smeAssignment?.status === 'PROPOSED').length;
  const items: MatchItemDto[] = rows.map((r) => ({
    candidateId: r.candidateId,
    name: r.candidate.smeUser.displayName ?? 'Unnamed candidate',
    rank: r.rank,
    score: Number(r.score),
    breakdown: r.breakdown as MatchItemDto['breakdown'],
    skills: [...new Set([...r.candidate.specialties, ...r.candidate.skills])],
    country: r.candidate.country,
    city: r.candidate.city,
    languages: r.candidate.languages as MatchItemDto['languages'],
    hoursPerWeek: r.candidate.hoursPerWeek,
    timezone: r.candidate.timezone,
    lastValidatedAt: r.candidate.lastValidatedAt?.toISOString() ?? null,
    status: !byCandidate.has(r.candidateId) ? 'AVAILABLE' : byCandidate.get(r.candidateId)!.smeAssignment?.status === 'PROPOSED' ? 'PROPOSED' : 'ASSIGNED',
    assignmentId: byCandidate.get(r.candidateId)?.id ?? null,
  }));
  const required = p.requiredWorkers ?? 0;
  return {
    projectId: p.id,
    projectName: p.name,
    status: p.status,
    requiredWorkers: p.requiredWorkers,
    assigned: accepted,
    proposed,
    shortfall: Math.max(0, required - accepted - proposed),
    matchedAt: p.matchedAt?.toISOString() ?? null,
    items,
    warnings,
  };
}

/** STAFFED once accepted assignments reach the required headcount (decided 26 Sep 2026); emits project.staffed. */
export async function markStaffedIfReady(tx: Tx, projectId: string, audit: (i: AuditInput) => Promise<void>, emit: (e: OutboxInput) => Promise<void>) {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  if (p.status !== 'STAFFING') return false;
  const required = p.requiredWorkers ?? 0;
  const { accepted } = await assignmentCounts(tx, projectId);
  if (accepted < required) return false;
  await tx.project.update({ where: { id: projectId }, data: { status: 'STAFFED' } });
  await audit({ entityType: 'Project', entityId: projectId, action: 'project.staffed', before: { status: 'STAFFING' }, after: { status: 'STAFFED', assigned: accepted, requiredWorkers: required } });
  await emit({ name: 'project.staffed', aggregateType: 'Project', aggregateId: projectId, payload: { projectId, assigned: accepted, requiredWorkers: required } });
  return true;
}
