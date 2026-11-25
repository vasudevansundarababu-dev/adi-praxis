import { z } from 'zod';
import type { ApprovedTaskRecord } from '@prisma/client';
import { citedRules } from './clause-export';
import maps from './policy-id-maps.json';

/**
 * D-056 (owner, 24 Nov 2026: "4. Yes"): a task's S4 cites ADI Forge's own ids (a project rule or the policy document it
 * came from, e.g. 54e00852… at rs2.d1). The benchmark environment knows its policies by other ids (KYC-01…, GB-02…),
 * so `policy.read` with a Forge id finds nothing. At export, each cited id is mapped to the environment's policy ids
 * from a reviewed mapping for the template's Studio release.
 *
 * Rules:
 * - export only: the task, its approvals, its stored package and earlier exports are never changed;
 * - a match is exact: the Forge id AND its content hash, against a policy the environment declares; a cited id with no
 *   entry, or an entry naming a policy the environment does not declare, is flagged (POLICY_ID_UNMAPPED), never guessed;
 * - the mapping is data reviewed by a person (confirmed_by), kept in policy-id-maps.json per Studio template version.
 */

const Sha = z.string().regex(/^[0-9a-f]{64}$/);
const EnvPolicy = z.object({ id: z.string().min(1).max(100), version: z.string().min(1).max(100), content_sha256: Sha, title: z.string().max(300).optional() }).strict();
const Entry = z
  .object({
    forge: z.object({ kind: z.enum(['rule', 'document']), id: z.string().min(1).max(200), content_sha256: Sha, label: z.string().max(300).optional() }).strict(),
    environment_policy_ids: z.array(z.string().min(1).max(100)).min(1),
    confirmed_by: z.string().min(1).max(200),
    confirmed_at: z.string().min(1).max(40),
  })
  .strict();
const PolicyIdMap = z
  .object({ studio_template_id: z.string().min(1), studio_version: z.number().int().min(1), environment: z.string().min(1), environment_policies: z.array(EnvPolicy), entries: z.array(Entry) })
  .strict();
export const PolicyIdMaps = z.object({ schema: z.literal('praxis.policy-id-map.v1'), maps: z.array(PolicyIdMap) }).strict();
export type PolicyIdMap = z.infer<typeof PolicyIdMap>;

const loaded = PolicyIdMaps.parse(maps);

/** The reviewed mapping for a Studio template version, or null when there is none. */
export function policyIdMapFor(ref: { id: string; version: number } | null, source: z.infer<typeof PolicyIdMaps> = loaded): PolicyIdMap | null {
  if (!ref) return null;
  return source.maps.find((m) => m.studio_template_id === ref.id && m.studio_version === ref.version) ?? null;
}

export interface MappedPolicy {
  forge_rule_id: string;
  forge_content_sha256: string;
  environment_policy_ids: string[];
}
export interface UnmappedPolicy {
  ruleId: string;
  contentSha256: string;
  message: string;
}

/** Maps every S4 citation of a record; whatever cannot be mapped exactly is returned as unmapped, with the reason. */
export function mapRecordPolicies(record: Pick<ApprovedTaskRecord, 'output'>, map: PolicyIdMap | null): { mapped: MappedPolicy[]; unmapped: UnmappedPolicy[] } {
  const mapped: MappedPolicy[] = [];
  const unmapped: UnmappedPolicy[] = [];
  const declared = new Set((map?.environment_policies ?? []).map((p) => p.id));
  for (const c of citedRules(record.output)) {
    const short = c.ruleId.slice(0, 8);
    if (!map) {
      unmapped.push({ ...c, message: `S4 cites policy ${short}…, and there is no reviewed mapping to the benchmark environment's policy ids for this template version yet, so the agent's policy.read will not find it.` });
      continue;
    }
    const entry = map.entries.find((e) => e.forge.id === c.ruleId && e.forge.content_sha256 === c.contentSha256);
    if (!entry) {
      const otherVersion = map.entries.some((e) => e.forge.id === c.ruleId);
      unmapped.push({ ...c, message: `S4 cites policy ${short}…${otherVersion ? ' at a version the mapping does not cover' : ''}, which has no mapping to ${map.environment}'s policy ids, so the agent's policy.read will not find it.` });
      continue;
    }
    const missing = entry.environment_policy_ids.filter((id) => !declared.has(id));
    if (missing.length) {
      unmapped.push({ ...c, message: `The mapping for policy ${short}… names ${missing.join(', ')}, which ${map.environment} does not declare. Fix the mapping.` });
      continue;
    }
    mapped.push({ forge_rule_id: c.ruleId, forge_content_sha256: c.contentSha256, environment_policy_ids: [...entry.environment_policy_ids] });
  }
  return { mapped, unmapped };
}

export const POLICY_ID_UNMAPPED = 'POLICY_ID_UNMAPPED' as const;
