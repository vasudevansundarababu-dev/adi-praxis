import type { Requisition } from '@prisma/client';
import { TIER_LABELS } from '@praxis/shared';
import type { Db } from '../db';
import type { Section } from './generator';

/**
 * What partners see of a requisition's guidelines (docs/SME-SUPPLY.md section 4): a summary (package and section
 * headings) and the course outline (module titles, test length). Never items, answers or scoring rules. Null until
 * the requisition's tier is published.
 */
export async function partnerGuidelinesView(db: Db, r: Requisition) {
  if (!r.guidelinesPackageId) return { guidelinesSummary: null, courseOutline: null };
  const v = await db.guidelinesVersion.findFirst({
    where: { packageId: r.guidelinesPackageId, status: 'PUBLISHED', publishedTiers: { has: r.tier }, ...(r.guidelinesVersion ? { version: r.guidelinesVersion } : {}) },
    orderBy: { version: 'desc' },
    include: { package: true, courses: { where: { tier: r.tier }, include: { modules: { orderBy: { position: 'asc' }, select: { position: true, title: true } } } }, blueprints: { where: { tier: r.tier } } },
  });
  if (!v) return { guidelinesSummary: null, courseOutline: null };
  const course = v.courses[0];
  const bp = v.blueprints[0];
  return {
    guidelinesSummary: { name: v.package.name, taskFamily: v.package.taskFamily, version: v.version, sections: (v.sections as unknown as Section[]).map((s) => s.heading) },
    courseOutline: course
      ? { title: course.title, tier: r.tier, tierLabel: TIER_LABELS[r.tier], modules: course.modules.map((m) => ({ position: m.position, title: m.title })), test: bp ? { questions: bp.itemCount + (bp.authoringTask ? 1 : 0), timeLimitMinutes: bp.timeLimitMinutes, authoringTask: bp.authoringTask } : null }
      : null,
  };
}
