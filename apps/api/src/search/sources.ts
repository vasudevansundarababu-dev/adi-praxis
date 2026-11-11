import type { Db } from '../db';
import type { InternalActor } from '../auth/actor';

/** The lists that have a search bar (owner, 12 Nov 2026). */
export const SEARCH_TYPES = ['projects', 'templates', 'candidates', 'requisitions', 'users', 'partners'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/**
 * One searchable record. `text` is matched by letters (database only). `meaning` is the professional text sent to the
 * embedding model: never names, emails or other personal details.
 */
export interface SearchRow {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  text: string;
  meaning: string;
  updatedAt: Date;
}

export interface SearchSource {
  roles: readonly string[];
  /** Rows this actor may already see in the list (same rules as the list endpoint). */
  visible(db: Db, actor: InternalActor): Promise<SearchRow[]>;
}

const join = (...xs: (string | null | undefined | string[])[]) => xs.flat().filter(Boolean).join(' · ');
const isAdmin = (a: InternalActor) => a.roles.includes('ADMIN');

export const SEARCH_SOURCES: Record<SearchType, SearchSource> = {
  projects: {
    roles: ['PM', 'ADMIN'],
    async visible(db, a) {
      const rows = await db.project.findMany({
        where: { clientId: a.clientId, ...(isAdmin(a) ? {} : { ownerId: a.userId }) },
        include: { template: { include: { domain: true } }, owner: true },
      });
      return rows.map((p) => ({
        id: p.id,
        title: p.name,
        subtitle: join(p.template.workflowName, p.status.toLowerCase().replace(/_/g, ' ')),
        href: `/projects/${p.id}`,
        text: join(p.name, p.description, p.template.workflowName, p.template.domain.name, p.owner.name, p.status),
        meaning: join(p.name, p.description, p.template.workflowName, p.template.domain.name, p.template.primaryWork, p.template.skills),
        updatedAt: p.updatedAt,
      }));
    },
  },
  templates: {
    roles: ['PM', 'ADMIN'],
    async visible(db, a) {
      // PMs see what FLOW 1 may offer; Admins see every version.
      const rows = await db.template.findMany({
        where: { clientId: a.clientId, ...(isAdmin(a) ? {} : { status: 'PUBLISHED', domain: { status: 'ACTIVE' } }) },
        include: { domain: true },
      });
      return rows.map((t) => ({
        id: t.id,
        title: t.workflowName,
        subtitle: join(t.domain.name, `v${t.version}`, t.status.toLowerCase()),
        href: `/templates/${t.id}`,
        text: join(t.workflowName, t.domain.name, t.skills, t.primaryWork, t.status),
        meaning: join(t.workflowName, t.domain.name, t.skills, t.primaryWork, t.verificationCriteria),
        updatedAt: t.updatedAt,
      }));
    },
  },
  candidates: {
    roles: ['REVIEWER', 'ADMIN'],
    async visible(db, a) {
      // Same scope as the Applications queue: assigned projects only (Admins: all), never a declared conflict.
      const projectIds = isAdmin(a) ? undefined : (await db.projectReviewer.findMany({ where: { userId: a.userId } })).map((r) => r.projectId);
      const conflicts = new Set((await db.conflictDeclaration.findMany({ where: { reviewerId: a.userId, resolvedAt: null } })).map((c) => c.smeUserId));
      const rows = await db.enrollment.findMany({
        where: { clientId: a.clientId, status: { notIn: ['DRAFT', 'WITHDRAWN'] }, ...(projectIds ? { opportunity: { projectId: { in: projectIds } } } : {}) },
        include: { smeUser: { include: { candidate: true } }, opportunity: { include: { project: true } }, opportunityVersion: true },
      });
      return rows
        .filter((e) => !conflicts.has(e.smeUserId))
        .map((e) => {
          const c = e.smeUser.candidate;
          const post = (e.opportunityVersion.brief as { title?: string }).title ?? '';
          const pro = join(c?.specialties ?? [], c?.skills ?? [], c?.jurisdictions ?? []);
          return {
            id: e.id,
            title: e.smeUser.displayName ?? 'Applicant',
            subtitle: join(e.opportunity.project.name, e.status.toLowerCase().replace(/_/g, ' ')),
            href: `/review/applications/${e.id}`,
            text: join(e.smeUser.displayName, e.smeUser.contactEmail, e.opportunity.project.name, post, pro, e.status),
            meaning: join(post, pro),
            updatedAt: new Date(Math.max(e.updatedAt.getTime(), c?.updatedAt.getTime() ?? 0)),
          };
        });
    },
  },
  requisitions: {
    roles: ['PM', 'ADMIN', 'REVIEWER'],
    async visible(db, a) {
      const rows = await db.requisition.findMany({
        where: { clientId: a.clientId, ...(isAdmin(a) || a.roles.includes('REVIEWER') ? {} : { project: { ownerId: a.userId } }) },
        include: { project: true },
      });
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: join(r.project.name, r.tier.toLowerCase().replace(/_/g, ' '), r.state.toLowerCase()),
        href: `/requisitions/${r.id}`,
        text: join(r.title, r.summary, r.domain, r.project.name, r.tier, r.state, r.jurisdictions, r.languages, r.location),
        meaning: join(r.title, r.summary, r.domain, r.jurisdictions),
        updatedAt: r.updatedAt,
      }));
    },
  },
  users: {
    roles: ['ADMIN'],
    async visible(db, a) {
      const rows = await db.user.findMany({ where: { clientId: a.clientId } });
      // People: matched by letters only; nothing about them goes to the embedding model.
      return rows.map((u) => ({
        id: u.id,
        title: u.name,
        subtitle: join(u.email, u.roles.join(', ').toLowerCase()),
        href: `/users#user-${u.id}`,
        text: join(u.name, u.email, u.roles, u.status),
        meaning: '',
        updatedAt: u.updatedAt,
      }));
    },
  },
  partners: {
    roles: ['ADMIN', 'PM'],
    async visible(db, a) {
      const rows = await db.partner.findMany({ where: { clientId: a.clientId } });
      return rows.map((p) => ({
        id: p.id,
        title: p.name,
        subtitle: p.status.toLowerCase(),
        href: `/partners/${p.id}`,
        text: join(p.name, p.status),
        meaning: join(p.name),
        updatedAt: p.updatedAt,
      }));
    },
  },
};
