import { Prisma, type AuditEvent, type Domain, type PrismaClient, type Template } from '@prisma/client';
import { publishProblems, sectionProblems, validSectionCount, BLUEPRINT_SECTIONS, type HarborBlueprint } from '@praxis/shared';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CATALOG_V2, RETIRED_DOMAINS, loadCatalogBlueprint, normaliseName, type CatalogWorkflowFields } from './index';

/**
 * The catalog change of PRD D15 / D15a (architecture §11, AD-07).
 * - `seedCatalogV2` upserts the mockup catalog: reuses existing lineages by normalised name, creates the missing
 *   domains and workflows, and publishes every workflow (the three full blueprints under the `publishProblems` rules,
 *   the rest from the owner's publish fields; owner decision 10 Nov 2026: seeded templates are published by default).
 *   An existing unused DRAFT is published with the fields; a draft used by a project and a RETIRED row keep their state.
 * - `retireOldCatalog` retires the D15a domains and every workflow of a catalog domain that is not in the mockup.
 * - `reverseCatalogV2` restores the statuses recorded in the audit log; rows the job created are retired. Running the
 *   job again after a reverse reinstates the catalog workflows that the reverse retired.
 * Rows used by a project keep their state, nothing is deleted, and every change is audited as SYSTEM:catalog-v2 with
 * the previous status. With `apply: false` nothing is written and the same plan is returned (dry run).
 */

export const CATALOG_V2_ACTOR = 'catalog-v2';
export const CATALOG_V2_REVERSED = 'catalog_v2.reversed';

type Db = PrismaClient | Prisma.TransactionClient;

export type CatalogChangeAction =
  | 'domain.created'
  | 'domain.activated'
  | 'domain.retired'
  | 'template.created'
  | 'template.published'
  | 'template.version_created'
  | 'template.reinstated'
  | 'template.retired'
  | typeof CATALOG_V2_REVERSED;

export interface CatalogChange {
  action: CatalogChangeAction;
  entityType: 'Domain' | 'Template';
  /** Null in a dry run for rows that do not exist yet. */
  entityId: string | null;
  domain: string;
  workflowName: string | null;
  version: number | null;
  from: string | null;
  to: string;
}

export interface CatalogNote {
  kind: 'reused' | 'kept_used_by_project' | 'blueprint_present' | 'not_listed' | 'reverse_skipped';
  entityType: 'Domain' | 'Template';
  entityId: string;
  domain: string;
  workflowName: string | null;
  version: number | null;
  status: string;
  detail: string;
}

export interface CatalogPlan {
  clientId: string;
  applied: boolean;
  changes: CatalogChange[];
  notes: CatalogNote[];
}

export interface CatalogRunOptions {
  apply: boolean;
}

const sameName = (a: string, b: string) => normaliseName(a) === normaliseName(b);
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Serialises catalog runs per client so two concurrent runs cannot create the same workflow twice. */
async function lockCatalog(tx: Prisma.TransactionClient, clientId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-v2:${clientId}`}))`;
}

function recorder(tx: Db, clientId: string, plan: CatalogPlan, apply: boolean) {
  return {
    async change(c: CatalogChange, before: Record<string, unknown> | null, after: Record<string, unknown> = {}) {
      plan.changes.push(c);
      if (!apply) return;
      await tx.auditEvent.create({
        data: {
          clientId,
          actorType: 'SYSTEM',
          actorId: CATALOG_V2_ACTOR,
          entityType: c.entityType,
          entityId: c.entityId!,
          action: c.action,
          before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
          after: { status: c.to, domain: c.domain, workflowName: c.workflowName, version: c.version, ...after } as Prisma.InputJsonValue,
        },
      });
    },
    note(n: CatalogNote) {
      plan.notes.push(n);
    },
  };
}

/** Template columns that panel 0 and stage 1 of a blueprint fill (D11b). */
export function templateFieldsFromBlueprint(bp: HarborBlueprint) {
  return {
    primaryWork: bp.catalog.primary_work,
    verificationCriteria: bp.catalog.verification_criteria,
    humanGate: bp.catalog.human_gate,
    skills: bp.catalog.skills,
    taskModes: bp.catalog.task_modes,
    defaultTptMinutes: bp.template_meta.tpt_minutes,
    defaultDistinctTarget: bp.catalog.default_distinct_target,
    defaultMaxPerExpert: bp.catalog.default_max_per_expert,
    coverageDimensions: bp.catalog.coverage_dimensions as unknown as Prisma.InputJsonValue,
    edgeCaseCatalog: bp.catalog.edge_case_catalog as unknown as Prisma.InputJsonValue,
    ...(bp.catalog.default_jd_id ? { defaultJdId: bp.catalog.default_jd_id } : {}),
    executionMode: bp.template_meta.modes[0] ?? null,
    blueprint: bp as unknown as Prisma.InputJsonValue,
  };
}

/** The publish route's rules (`publishProblems`, active domain) plus a 6/6 valid blueprint (S1-17). */
function assertPublishable(workflowName: string, bp: HarborBlueprint) {
  const problems = publishProblems({
    workflowName,
    primaryWork: bp.catalog.primary_work,
    verificationCriteria: bp.catalog.verification_criteria,
    humanGate: bp.catalog.human_gate,
    defaultTptMinutes: bp.template_meta.tpt_minutes,
    skills: bp.catalog.skills,
    taskModes: bp.catalog.task_modes,
  });
  const sections = sectionProblems(bp);
  if (validSectionCount(sections) !== BLUEPRINT_SECTIONS.length) {
    problems.push(...BLUEPRINT_SECTIONS.flatMap((s) => sections[s].map((p) => `${s}: ${p}`)));
  }
  if (problems.length > 0) throw new Error(`Catalog blueprint for "${workflowName}" cannot be published: ${problems.join('; ')}`);
}

/** Template columns the owner's publish fields fill for a workflow without a blueprint (D15, 10 Nov 2026). */
export function templateFieldsFromFields(f: CatalogWorkflowFields) {
  return {
    primaryWork: f.primaryWork,
    verificationCriteria: f.verificationCriteria,
    humanGate: f.humanGate,
    skills: f.skills,
    taskModes: f.taskModes,
    defaultTptMinutes: f.defaultTptMinutes,
  };
}

/** The publish route's rules (`publishProblems`) for a workflow seeded from the owner's fields. */
function assertFieldsPublishable(workflowName: string, f: CatalogWorkflowFields) {
  const problems = publishProblems({ workflowName, ...f });
  if (problems.length > 0) throw new Error(`Catalog fields for "${workflowName}" cannot be published: ${problems.join('; ')}`);
}

/** One entry per lineage: its versions, newest first. The lineage is named after its newest version. */
function lineages(templates: Template[]): Template[][] {
  const by = new Map<string, Template[]>();
  for (const t of templates) by.set(t.lineageId, [...(by.get(t.lineageId) ?? []), t]);
  return [...by.values()]
    .map((vs) => vs.sort((a, b) => b.version - a.version))
    .sort((a, b) => a[a.length - 1]!.createdAt.getTime() - b[b.length - 1]!.createdAt.getTime() || a[0]!.lineageId.localeCompare(b[0]!.lineageId));
}

async function projectCounts(tx: Db, templateIds: string[]): Promise<Map<string, number>> {
  if (templateIds.length === 0) return new Map();
  const rows = await tx.project.groupBy({ by: ['templateId'], where: { templateId: { in: templateIds } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.templateId, r._count._all]));
}

async function findDomain(tx: Db, clientId: string, name: string): Promise<Domain | null> {
  return tx.domain.findFirst({ where: { clientId, name: { equals: name, mode: 'insensitive' } } });
}

async function seedInto(tx: Db, clientId: string, plan: CatalogPlan, apply: boolean) {
  const rec = recorder(tx, clientId, plan, apply);

  for (const d of CATALOG_V2) {
    let domain = await findDomain(tx, clientId, d.name);
    if (!domain) {
      domain = apply ? await tx.domain.create({ data: { clientId, name: d.name } }) : null;
      await rec.change({ action: 'domain.created', entityType: 'Domain', entityId: domain?.id ?? null, domain: d.name, workflowName: null, version: null, from: null, to: 'ACTIVE' }, null);
    } else if (domain.status !== 'ACTIVE') {
      if (apply) await tx.domain.update({ where: { id: domain.id }, data: { status: 'ACTIVE' } });
      await rec.change({ action: 'domain.activated', entityType: 'Domain', entityId: domain.id, domain: domain.name, workflowName: null, version: null, from: domain.status, to: 'ACTIVE' }, { status: domain.status });
    }

    const existing = domain ? lineages(await tx.template.findMany({ where: { clientId, domainId: domain.id } })) : [];
    const used = await projectCounts(tx, existing.flat().map((t) => t.id));
    const lastEvents = await lastCatalogEvents(tx, clientId, existing.map((vs) => vs[0]!.id));
    const domainName = domain?.name ?? d.name;

    for (const w of d.workflows) {
      const bp = w.blueprint ? loadCatalogBlueprint(w.blueprint) : null;
      const fields = w.fields ?? null;
      if (bp) assertPublishable(w.workflowName, bp);
      if (fields) assertFieldsPublishable(w.workflowName, fields);
      const versions = existing.find((vs) => sameName(vs[0]!.workflowName, w.workflowName));

      if (!versions) {
        const status = bp || fields ? 'PUBLISHED' : 'DRAFT';
        let id: string | null = null;
        if (apply) {
          const t = await tx.template.create({
            data: {
              clientId,
              domainId: domain!.id,
              lineageId: randomUUID(),
              version: 1,
              workflowName: w.workflowName,
              status,
              ...(bp ? { ...templateFieldsFromBlueprint(bp), blueprintRevision: 1, publishedAt: new Date() } : {}),
              ...(fields ? { ...templateFieldsFromFields(fields), publishedAt: new Date() } : {}),
            },
          });
          id = t.id;
        }
        await rec.change({ action: 'template.created', entityType: 'Template', entityId: id, domain: domainName, workflowName: w.workflowName, version: 1, from: null, to: status }, null, { blueprint: w.blueprint });
        continue;
      }

      let latest = versions[0]!;
      const reinstate = reinstatable(latest, lastEvents.get(latest.id));
      if (reinstate) {
        if (apply) {
          const { count } = await tx.template.updateMany({
            where: { id: latest.id, status: 'RETIRED' },
            data: { status: reinstate.status, retiredAt: null, ...(reinstate.status === 'PUBLISHED' ? { publishedAt: new Date() } : {}) },
          });
          if (count !== 1) throw new Error(`Template ${latest.id} changed while catalog-v2 was running; run it again`);
        }
        await rec.change(
          { action: 'template.reinstated', entityType: 'Template', entityId: latest.id, domain: domainName, workflowName: latest.workflowName, version: latest.version, from: 'RETIRED', to: reinstate.status },
          { status: 'RETIRED', publishedAt: iso(latest.publishedAt), retiredAt: iso(latest.retiredAt) },
          { reinstatedFrom: reinstate.eventId },
        );
        latest = { ...latest, status: reinstate.status };
      }
      const reused: CatalogNote = { kind: 'reused', entityType: 'Template', entityId: latest.id, domain: domainName, workflowName: latest.workflowName, version: latest.version, status: latest.status, detail: `lineage ${latest.lineageId} reused for "${w.workflowName}"` };

      // Owner decision (10 Nov 2026): seeded templates are published by default. An unused DRAFT is published with the
      // owner's fields; a draft used by a project and a RETIRED row keep their state (rows the job created are
      // reinstated above). A row already PUBLISHED is left as it is.
      if (fields) {
        if (latest.status !== 'DRAFT') {
          if (!reinstate) rec.note(reused);
          continue;
        }
        if (used.get(latest.id)) {
          rec.note({ ...reused, kind: 'kept_used_by_project', detail: `draft used by ${used.get(latest.id)} project(s); not changed` });
          continue;
        }
        if (apply) {
          const { count } = await tx.template.updateMany({
            where: { id: latest.id, status: 'DRAFT' },
            data: { ...templateFieldsFromFields(fields), status: 'PUBLISHED', publishedAt: new Date() },
          });
          if (count !== 1) throw new Error(`Template ${latest.id} changed while catalog-v2 was running; run it again`);
        }
        await rec.change(
          { action: 'template.published', entityType: 'Template', entityId: latest.id, domain: domainName, workflowName: latest.workflowName, version: latest.version, from: 'DRAFT', to: 'PUBLISHED' },
          { status: 'DRAFT', publishedAt: null, retiredAt: iso(latest.retiredAt), fields: overwrittenFields(latest) },
        );
        continue;
      }

      if (!bp) {
        if (!reinstate) rec.note(reused);
        continue;
      }

      // A draft holding the unchanged catalog blueprint (left by a reverse) is published as it is.
      const catalogDraft = latest.status === 'DRAFT' && latest.blueprint !== null && isDeepStrictEqual(latest.blueprint, JSON.parse(JSON.stringify(bp)));
      const earlier = catalogDraft ? versions.slice(1) : versions;
      if (earlier.some((v) => v.blueprint !== null) || (latest.blueprint !== null && !catalogDraft)) {
        if (!reinstate) rec.note({ ...reused, kind: 'blueprint_present', detail: 'a version of this workflow already holds a blueprint; unchanged' });
        continue;
      }

      if (latest.status === 'DRAFT') {
        if (used.get(latest.id)) {
          rec.note({ ...reused, kind: 'kept_used_by_project', detail: `draft used by ${used.get(latest.id)} project(s); not changed` });
          continue;
        }
        if (apply) {
          const { count } = await tx.template.updateMany({
            where: { id: latest.id, status: 'DRAFT', ...(catalogDraft ? {} : { blueprint: { equals: Prisma.DbNull } }) },
            data: {
              ...(catalogDraft ? {} : { ...templateFieldsFromBlueprint(bp), blueprintRevision: latest.blueprintRevision + 1 }),
              status: 'PUBLISHED',
              publishedAt: new Date(),
            },
          });
          if (count !== 1) throw new Error(`Template ${latest.id} changed while catalog-v2 was running; run it again`);
        }
        await rec.change(
          { action: 'template.published', entityType: 'Template', entityId: latest.id, domain: domainName, workflowName: latest.workflowName, version: latest.version, from: 'DRAFT', to: 'PUBLISHED' },
          { status: 'DRAFT', publishedAt: null, retiredAt: iso(latest.retiredAt), ...(catalogDraft ? {} : { fields: overwrittenFields(latest) }) },
          { blueprint: w.blueprint },
        );
        continue;
      }

      // The newest version is PUBLISHED or RETIRED: a new version carries the blueprint, as the "new version" action does.
      let id: string | null = null;
      if (apply) {
        const { id: _id, createdAt: _c, updatedAt: _u, publishedAt: _p, retiredAt: _r, ...copy } = latest;
        const t = await tx.template.create({
          data: {
            ...copy,
            taskDefinitionSchema: copy.taskDefinitionSchema as Prisma.InputJsonValue,
            collectionSchema: copy.collectionSchema as Prisma.InputJsonValue,
            ...templateFieldsFromBlueprint(bp),
            blueprintRevision: 1,
            version: latest.version + 1,
            status: 'PUBLISHED',
            publishedAt: new Date(),
          } as Prisma.TemplateUncheckedCreateInput,
        });
        id = t.id;
      }
      await rec.change(
        { action: 'template.version_created', entityType: 'Template', entityId: id, domain: domainName, workflowName: latest.workflowName, version: latest.version + 1, from: null, to: 'PUBLISHED' },
        null,
        { blueprint: w.blueprint, sourceId: latest.id, sourceVersion: latest.version },
      );
    }
  }
}

async function lastCatalogEvents(tx: Db, clientId: string, entityIds: string[]): Promise<Map<string, AuditEvent>> {
  const events = await tx.auditEvent.findMany({
    where: { clientId, actorType: 'SYSTEM', actorId: CATALOG_V2_ACTOR, entityId: { in: entityIds } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return new Map(events.map((e) => [e.entityId, e]));
}

/**
 * A catalog workflow that a `--reverse` retired (its last catalog-v2 event is that reversal) is put back to the status
 * it had before the reversal, so running the job again after a reverse restores the catalog. Rows an Admin retired
 * are left alone.
 */
function reinstatable(t: Template, last: AuditEvent | undefined): { status: 'DRAFT' | 'PUBLISHED'; eventId: string } | null {
  if (t.status !== 'RETIRED' || last?.action !== CATALOG_V2_REVERSED) return null;
  const status = (last.before as { status?: string } | null)?.status;
  return status === 'DRAFT' || status === 'PUBLISHED' ? { status, eventId: last.id } : null;
}

function overwrittenFields(t: Template) {
  return {
    primaryWork: t.primaryWork,
    verificationCriteria: t.verificationCriteria,
    humanGate: t.humanGate,
    skills: t.skills,
    taskModes: t.taskModes,
    defaultTptMinutes: t.defaultTptMinutes,
    defaultDistinctTarget: t.defaultDistinctTarget,
    defaultMaxPerExpert: t.defaultMaxPerExpert,
    coverageDimensions: t.coverageDimensions,
    edgeCaseCatalog: t.edgeCaseCatalog,
    executionMode: t.executionMode,
  };
}

async function retireInto(tx: Db, clientId: string, plan: CatalogPlan, apply: boolean) {
  const rec = recorder(tx, clientId, plan, apply);
  const domains = await tx.domain.findMany({ where: { clientId }, orderBy: { name: 'asc' } });

  for (const domain of domains) {
    const catalog = CATALOG_V2.find((d) => sameName(d.name, domain.name));
    const retireWholeDomain = RETIRED_DOMAINS.some((n) => sameName(n, domain.name));
    if (!catalog && !retireWholeDomain) {
      rec.note({ kind: 'not_listed', entityType: 'Domain', entityId: domain.id, domain: domain.name, workflowName: null, version: null, status: domain.status, detail: 'not in the mockup catalog and not listed in D15a; left as is' });
      continue;
    }
    if (retireWholeDomain && domain.status === 'ACTIVE') {
      if (apply) {
        const { count } = await tx.domain.updateMany({ where: { id: domain.id, status: 'ACTIVE' }, data: { status: 'RETIRED' } });
        if (count !== 1) throw new Error(`Domain ${domain.id} changed while catalog-v2 was running; run it again`);
      }
      await rec.change({ action: 'domain.retired', entityType: 'Domain', entityId: domain.id, domain: domain.name, workflowName: null, version: null, from: 'ACTIVE', to: 'RETIRED' }, { status: 'ACTIVE' });
    }

    const all = lineages(await tx.template.findMany({ where: { clientId, domainId: domain.id } }));
    const outside = all.filter((vs) => !catalog?.workflows.some((w) => sameName(w.workflowName, vs[0]!.workflowName)));
    const used = await projectCounts(tx, outside.flat().map((t) => t.id));
    for (const t of outside.flat().sort((a, b) => a.workflowName.localeCompare(b.workflowName) || a.version - b.version)) {
      if (t.status === 'RETIRED') continue;
      const n = used.get(t.id);
      if (n) {
        rec.note({ kind: 'kept_used_by_project', entityType: 'Template', entityId: t.id, domain: domain.name, workflowName: t.workflowName, version: t.version, status: t.status, detail: `used by ${n} project(s); keeps its state` });
        continue;
      }
      if (apply) {
        const { count } = await tx.template.updateMany({ where: { id: t.id, status: t.status }, data: { status: 'RETIRED', retiredAt: new Date() } });
        if (count !== 1) throw new Error(`Template ${t.id} changed while catalog-v2 was running; run it again`);
      }
      await rec.change(
        { action: 'template.retired', entityType: 'Template', entityId: t.id, domain: domain.name, workflowName: t.workflowName, version: t.version, from: t.status, to: 'RETIRED' },
        { status: t.status, publishedAt: iso(t.publishedAt), retiredAt: iso(t.retiredAt) },
      );
    }
  }
}

async function reverseInto(tx: Db, clientId: string, plan: CatalogPlan, apply: boolean) {
  const rec = recorder(tx, clientId, plan, apply);
  const events = await tx.auditEvent.findMany({
    where: { clientId, actorType: 'SYSTEM', actorId: CATALOG_V2_ACTOR },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const reversed = new Set(events.filter((e) => e.action === CATALOG_V2_REVERSED).map((e) => (e.after as { reverses?: string } | null)?.reverses));

  for (const e of events) {
    if (e.action === CATALOG_V2_REVERSED || reversed.has(e.id)) continue;
    const before = e.before as { status?: string; publishedAt?: string | null; retiredAt?: string | null } | null;
    const after = e.after as { status: string; domain: string; workflowName: string | null; version: number | null };
    // Rows the job created have no previous status; nothing is deleted, so they are retired instead.
    const target = before?.status ?? 'RETIRED';
    const skip = (status: string, detail: string) =>
      rec.note({ kind: 'reverse_skipped', entityType: e.entityType as 'Domain' | 'Template', entityId: e.entityId, domain: after.domain, workflowName: after.workflowName, version: after.version, status, detail });

    if (e.entityType === 'Domain') {
      const d = await tx.domain.findFirst({ where: { id: e.entityId, clientId } });
      if (!d) continue;
      if (d.status !== after.status) {
        skip(d.status, `status changed since ${e.action} (expected ${after.status}); not reversed`);
        continue;
      }
      if (apply) await tx.domain.update({ where: { id: d.id }, data: { status: target as Domain['status'] } });
      await rec.change({ action: CATALOG_V2_REVERSED, entityType: 'Domain', entityId: d.id, domain: d.name, workflowName: null, version: null, from: d.status, to: target }, { status: d.status }, { reverses: e.id, reversedAction: e.action });
      continue;
    }

    const t = await tx.template.findFirst({ where: { id: e.entityId, clientId }, include: { domain: true } });
    if (!t) continue;
    if (t.status !== after.status) {
      skip(t.status, `status changed since ${e.action} (expected ${after.status}); not reversed`);
      continue;
    }
    const n = (await projectCounts(tx, [t.id])).get(t.id);
    if (n) {
      skip(t.status, `used by ${n} project(s); keeps its state`);
      continue;
    }
    if (apply) {
      const restore = before
        ? { publishedAt: before.publishedAt ? new Date(before.publishedAt) : null, retiredAt: before.retiredAt ? new Date(before.retiredAt) : null }
        : { retiredAt: new Date() };
      const { count } = await tx.template.updateMany({ where: { id: t.id, status: t.status }, data: { status: target as Template['status'], ...restore } });
      if (count !== 1) throw new Error(`Template ${t.id} changed while catalog-v2 was running; run it again`);
    }
    await rec.change(
      { action: CATALOG_V2_REVERSED, entityType: 'Template', entityId: t.id, domain: t.domain.name, workflowName: t.workflowName, version: t.version, from: t.status, to: target },
      { status: t.status, publishedAt: iso(t.publishedAt), retiredAt: iso(t.retiredAt) },
      { reverses: e.id, reversedAction: e.action },
    );
  }
}

type Step = (tx: Db, clientId: string, plan: CatalogPlan, apply: boolean) => Promise<void>;

async function run(db: PrismaClient, clientId: string, steps: Step[], { apply }: CatalogRunOptions): Promise<CatalogPlan> {
  const plan: CatalogPlan = { clientId, applied: apply, changes: [], notes: [] };
  if (!apply) {
    for (const step of steps) await step(db, clientId, plan, false);
    return plan;
  }
  await db.$transaction(
    async (tx) => {
      await lockCatalog(tx, clientId);
      for (const step of steps) await step(tx, clientId, plan, true);
    },
    { timeout: 120_000 },
  );
  return plan;
}

/** Upserts the mockup catalog for one client (architecture §11). Idempotent; a second run changes nothing. */
export function seedCatalogV2(db: PrismaClient, clientId: string, opts: CatalogRunOptions = { apply: true }): Promise<CatalogPlan> {
  return run(db, clientId, [seedInto], opts);
}

/** The `catalog-v2` job for one client: the seed, then the D15a retirements, in one transaction. */
export function applyCatalogV2(db: PrismaClient, clientId: string, opts: CatalogRunOptions): Promise<CatalogPlan> {
  return run(db, clientId, [seedInto, retireInto], opts);
}

/** `catalog-v2 --reverse`: restores the statuses recorded by earlier runs, newest first. */
export function reverseCatalogV2(db: PrismaClient, clientId: string, opts: CatalogRunOptions): Promise<CatalogPlan> {
  return run(db, clientId, [reverseInto], opts);
}
