import { familiesOf, outcomeFieldsOf, type EdgeFamily, type OutcomeField } from '@praxis/shared';
import type { Template } from '@prisma/client';
import type { Db, Tx } from '../db';
import { jointParts } from './joint-template';
import { rlgymTemplateRef } from './rlgym-export';
import type { StudioClient } from './studio-client';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface FamilyCatalog {
  /** Where the families came from: Studio's catalog, or the template's S4 edge cases (one family per edge case). */
  source: 'catalog' | 'template';
  studioTemplate: { templateId: string; version: number } | null;
  environmentKey: string | null;
  catalogRevision: number | null;
  outcomeFields: OutcomeField[];
  families: EdgeFamily[];
  /** Why Studio's catalog was not used, in plain words (null when it was). */
  fallbackReason: string | null;
}

/** Studio's template ID and version for an Authoring template version (its RL Gym qualification, else the requirement). */
export async function studioRefOf(db: Db | Tx, t: Template): Promise<{ templateId: string; version: number } | null> {
  const req = (isObj(t.anvilSpec) && isObj(t.anvilSpec.requirement) ? t.anvilSpec.requirement : {}) as Record<string, unknown>;
  if (typeof req.studio_template_id === 'string' && Number.isInteger(req.studio_version)) return { templateId: req.studio_template_id, version: req.studio_version as number };
  const ref = await rlgymTemplateRef(db, t);
  return ref ? { templateId: ref.id, version: ref.version } : null;
}

const cache = new Map<string, { at: number; value: FamilyCatalog }>();
const TTL_MS = 60_000;

/**
 * E-001 §6b: the edge-case families of a template version, read live from Studio (edge-case-catalog.v2, cached for a
 * minute) and falling back to the template's S4 edge cases when Studio is not connected, has no catalog for the
 * version (404) or cannot be reached. Read-only: nothing about a task is rewritten from it.
 */
export async function familyCatalog(db: Db | Tx, t: Template, studio: StudioClient | null, opts: { fresh?: boolean } = {}): Promise<FamilyCatalog> {
  const s4 = jointParts(t)?.authoring.edge_cases ?? [];
  const fallback = (reason: string, ref: FamilyCatalog['studioTemplate']): FamilyCatalog => ({ source: 'template', studioTemplate: ref, environmentKey: null, catalogRevision: null, outcomeFields: [], families: familiesOf(null, s4), fallbackReason: reason });
  const ref = await studioRefOf(db, t);
  if (!studio) return fallback('Studio isn’t connected, so the families are the template’s own edge cases.', ref);
  if (!ref) return fallback('This template version has no Studio release, so the families are its own edge cases.', null);
  const key = `${t.id}:${ref.templateId}:${ref.version}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const r = await studio.edgeCaseCatalog(ref.templateId, ref.version);
  let value: FamilyCatalog;
  if (!r.ok) value = fallback(r.httpStatus === 404 ? 'Studio has no edge-case catalog for this template version yet, so the families are its own edge cases.' : `Studio’s catalog could not be read (${r.message}), so the families are the template’s own edge cases.`, ref);
  else {
    const data = isObj(r.data.data) ? r.data.data : r.data;
    const families = familiesOf(data, s4);
    value = { source: 'catalog', studioTemplate: ref, environmentKey: typeof data.environment_key === 'string' ? data.environment_key : null, catalogRevision: Number.isInteger(data.catalog_revision) ? (data.catalog_revision as number) : null, outcomeFields: outcomeFieldsOf(data), families, fallbackReason: null };
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** For tests: forget cached catalogs. */
export const clearFamilyCatalogCache = () => cache.clear();
