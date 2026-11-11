import type { JdRole, JobDescription, Prisma } from '@prisma/client';
import { generateJobDescriptions, type DemographicFilterInput, type GeneratedJd } from '@praxis/shared';
import type { Tx } from '../db';
import type { AuditInput } from '../platform/audit';
import { normalizeTitle, toJdDto } from '../routes/job-descriptions';

const lower = (xs: string[]) => new Set(xs.map((s) => s.trim().toLowerCase()));

/** Mandatory skills first, then any skills the PM added (old mandatory skills that the template dropped go away). */
function mergedSkills(gen: GeneratedJd, existing: JobDescription | null): string[] {
  if (!existing) return gen.mandatorySkills;
  const oldMandatory = lower(existing.mandatorySkills);
  const mandatory = lower(gen.mandatorySkills);
  const extra = existing.skills.filter((s) => !oldMandatory.has(s.trim().toLowerCase()) && !mandatory.has(s.trim().toLowerCase()));
  return [...gen.mandatorySkills, ...extra];
}

const requirementData = (gen: GeneratedJd, existing: JobDescription | null) => ({
  skills: mergedSkills(gen, existing),
  mandatorySkills: gen.mandatorySkills,
  minExperienceYears: gen.minExperienceYears,
  educationLevel: gen.educationLevel,
  demographicProfile: gen.demographicProfile as unknown as Prisma.InputJsonValue,
});

/**
 * Writes (or refreshes) the project's generated JDs (owner, 12 Nov 2026). The author JD is generated when the project
 * uses generated JDs; the reviewer JD whenever the review route needs an Expert. Requirements (mandatory skills,
 * experience, education, demographics) always follow the template and the project's filters. The title and the
 * responsibilities are rewritten only when the JD is new or the template changed, so PM edits are kept; pay and
 * location are the PM's and are never overwritten.
 */
export async function syncGeneratedJds(tx: Tx, projectId: string, audit: (i: AuditInput) => Promise<void>, opts: { templateChanged?: boolean } = {}) {
  const p = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { template: { include: { domain: true, defaultJd: true } }, demographicFilters: { orderBy: { createdAt: 'asc' } } },
  });
  if (p.status !== 'DRAFT') return;
  const attributes = await tx.demographicAttribute.findMany({ where: { clientId: p.clientId } });
  const filters: DemographicFilterInput[] = p.demographicFilters.map((f) => ({ attributeKey: f.attributeKey, operator: f.operator, values: f.values, required: f.required }));
  const gen = generateJobDescriptions({
    workflowName: p.template.workflowName,
    domainName: p.template.domain.name,
    primaryWork: p.template.primaryWork,
    skills: p.template.skills,
    taskMode: p.taskMode,
    reviewRoute: p.reviewRoute,
    tptMinutes: p.tptMinutes,
    filters,
    attributes: attributes.map((a) => ({ key: a.key, label: a.label, type: a.type, allowedValues: a.allowedValues })),
  });
  const existing = await tx.jobDescription.findMany({ where: { projectId: p.id, generated: true } });
  const byRole = new Map(existing.map((j) => [j.role, j]));

  // Pay and location start from the template's default JD (if any), else the author JD; the PM sets them.
  const terms = (fallback: JobDescription | null | undefined) => {
    const src = fallback ?? p.template.defaultJd;
    return {
      wagePerTask: src?.wagePerTask ?? 0,
      wageCurrency: src?.wageCurrency ?? 'USD',
      locationType: src?.locationType ?? ('REMOTE' as const),
      location: src?.location ?? null,
    };
  };

  async function upsert(g: GeneratedJd, role: JdRole, fallback: JobDescription | null | undefined): Promise<JobDescription> {
    const before = byRole.get(role) ?? null;
    if (!before) {
      const jd = await tx.jobDescription.create({
        data: {
          clientId: p.clientId,
          projectId: p.id,
          generated: true,
          role,
          title: g.title,
          normalizedTitle: normalizeTitle(g.title),
          responsibilities: g.responsibilities,
          ...terms(fallback),
          ...requirementData(g, null),
        },
      });
      await audit({ entityType: 'JobDescription', entityId: jd.id, action: 'job_description.generated', after: toJdDto(jd) });
      return jd;
    }
    const data = {
      ...requirementData(g, before),
      ...(opts.templateChanged ? { title: g.title, normalizedTitle: normalizeTitle(g.title), responsibilities: g.responsibilities } : {}),
    };
    const after = await tx.jobDescription.update({ where: { id: before.id }, data });
    const a = toJdDto(after);
    const b = toJdDto(before);
    const keys = (['title', 'responsibilities', 'skills', 'mandatorySkills', 'minExperienceYears', 'educationLevel', 'demographicProfile'] as const).filter(
      (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
    );
    if (keys.length) {
      await audit({
        entityType: 'JobDescription',
        entityId: after.id,
        action: 'job_description.regenerated',
        before: Object.fromEntries(keys.map((k) => [k, b[k]])),
        after: Object.fromEntries(keys.map((k) => [k, a[k]])),
      });
    }
    return after;
  }

  const author = p.jdGenerated ? await upsert(gen.author, 'AUTHOR', null) : null;
  const reviewer = gen.reviewer ? await upsert(gen.reviewer, 'REVIEWER', author ?? (p.jobDescriptionId ? await tx.jobDescription.findUnique({ where: { id: p.jobDescriptionId } }) : null)) : null;
  await tx.project.update({
    where: { id: p.id },
    data: {
      ...(author ? { jobDescriptionId: author.id } : {}),
      reviewerJobDescriptionId: reviewer?.id ?? null,
    },
  });
}
