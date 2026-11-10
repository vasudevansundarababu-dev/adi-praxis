import type { Prisma } from '@prisma/client';
import type { Db, Tx } from '../db';
import { AppError } from '../lib/errors';
import type { ProfileSnapshot, ProviderId } from './extraction/types';

/** Built-in allowlisted profiles (S2 §2). Created disabled per client; an Admin enables them. */
export const BUILTIN_PROFILES: Array<{ id: string; provider: ProviderId; label: string; isDefault: boolean; config: Record<string, unknown> }> = [
  { id: 'llama-agentic-v1', provider: 'llamaextract', label: 'LlamaExtract — Agentic (default)', isDefault: true, config: { tier: 'agentic', version: '2.5', confidenceScores: true } },
  { id: 'llama-cost-effective-v1', provider: 'llamaextract', label: 'LlamaExtract — Cost effective', isDefault: false, config: { tier: 'cost_effective', version: '2.5', confidenceScores: true } },
  { id: 'google-layout-gemini-v1', provider: 'google', label: 'Google — Document AI Layout Parser + Gemini Flash', isDefault: false, config: { model: 'gemini-2.5-flash' } },
];

export async function ensureProfiles(tx: Db | Tx, clientId: string) {
  const existing = await tx.extractionProfile.findMany({ where: { clientId }, select: { id: true } });
  const have = new Set(existing.map((e) => e.id));
  for (const p of BUILTIN_PROFILES) {
    if (have.has(p.id)) continue;
    await tx.extractionProfile.create({ data: { id: p.id, clientId, provider: p.provider, label: p.label, isDefault: p.isDefault, enabled: false, config: p.config as Prisma.InputJsonValue } }).catch(() => undefined);
  }
  return tx.extractionProfile.findMany({ where: { clientId }, orderBy: { id: 'asc' } });
}

export type SelectionSource = 'request' | 'project' | 'deployment';

/**
 * Resolves the profile for a new batch: per-request override (Admin only, checked by the caller) → project setting →
 * deployment default (S2 §2). Unknown or disabled profiles fail; there is no silent fallback to another provider.
 */
export async function resolveProfile(tx: Db | Tx, clientId: string, projectId: string, override: string | null): Promise<{ snapshot: ProfileSnapshot; source: SelectionSource }> {
  const profiles = await ensureProfiles(tx, clientId);
  let id: string | undefined;
  let source: SelectionSource;
  if (override) {
    id = override;
    source = 'request';
  } else {
    const setting = await tx.projectExtractionSetting.findUnique({ where: { projectId } });
    if (setting) {
      id = setting.profileId;
      source = 'project';
    } else {
      id = profiles.find((p) => p.isDefault)?.id;
      source = 'deployment';
    }
  }
  const p = profiles.find((x) => x.id === id);
  if (!p) throw new AppError(400, 'UNKNOWN_PROFILE', `Extraction profile "${id ?? '(none)'}" does not exist.`);
  if (!p.enabled) throw new AppError(409, 'PROFILE_DISABLED', `Extraction profile "${p.label}" is disabled. An Admin can enable it on a project's Policy rules page under Admin: extraction profiles, or authors can use Paste text.`);
  return { snapshot: { id: p.id, provider: p.provider as ProviderId, revision: p.revision, config: p.config as Record<string, unknown> }, source };
}
