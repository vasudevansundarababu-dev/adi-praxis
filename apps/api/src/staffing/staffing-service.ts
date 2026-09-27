import type { Prisma } from '@prisma/client';
import type { DemographicFilterInput, MatchesResponse, MatchItemDto } from '@praxis/shared';
import type { Db, Tx } from '../db';
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

export async function activeAssignmentCount(tx: Db | Tx, projectId: string) {
  return tx.projectAssignment.count({ where: { projectId, releasedAt: null } });
}

/** The Resource Assignment screen's data: header counts plus stored ranked matches. */
export async function listMatches(db: Db | Tx, projectId: string, warnings: string[] = []): Promise<MatchesResponse & { warnings: string[] }> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const [rows, assignments] = await Promise.all([
    db.projectMatch.findMany({
      where: { projectId },
      orderBy: { rank: 'asc' },
      include: { candidate: { include: { smeUser: { select: { displayName: true } } } } },
    }),
    db.projectAssignment.findMany({ where: { projectId, releasedAt: null } }),
  ]);
  const byCandidate = new Map(assignments.map((a) => [a.candidateId, a.id]));
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
    status: byCandidate.has(r.candidateId) ? 'ASSIGNED' : 'AVAILABLE',
    assignmentId: byCandidate.get(r.candidateId) ?? null,
  }));
  const required = p.requiredWorkers ?? 0;
  return {
    projectId: p.id,
    projectName: p.name,
    status: p.status,
    requiredWorkers: p.requiredWorkers,
    assigned: assignments.length,
    shortfall: Math.max(0, required - assignments.length),
    matchedAt: p.matchedAt?.toISOString() ?? null,
    items,
    warnings,
  };
}
