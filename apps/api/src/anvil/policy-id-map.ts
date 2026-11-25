import { z } from 'zod';
import type { ApprovedTaskRecord } from '@prisma/client';
import { citedRules } from './clause-export';
import maps from './policy-id-maps.json';

/**
 * D-056 (owner, 24 Nov 2026: "4. Yes"): a task's S4 cites ADI Forge's own ids (the policy document 54e00852… at rs2.d1,
 * or a project rule). The benchmark environment knows its policies by other ids (golden-kyc-openenv@12: KYC-01 to
 * KYC-04, GB-02, GB-03, GB-05), so `policy.read` with a Forge id finds nothing. At export, each cited id is mapped to
 * the environment's ids from a mapping the owner reviews and confirms (mechanical, no SME time).
 *
 * Rules:
 * - export only (`policy_id_map` on each task entry): the task, its approvals, its stored package and earlier exports
 *   are never changed;
 * - keyed by environment version, with each environment policy's text_sha256, so the RL Gym can check the map matches
 *   the environment it runs;
 * - a match is exact: the Forge id AND its content hash. These are flagged POLICY_ID_UNMAPPED and left out of the map,
 *   never guessed: no entry, an entry not confirmed yet, an entry with no clear match (no ids), or an id the
 *   environment does not declare.
 */

const Sha = z.string().regex(/^[0-9a-f]{64}$/);
const EnvPolicy = z.object({ id: z.string().min(1).max(100), title: z.string().max(300), text_sha256: Sha }).strict();
const Entry = z
  .object({
    forge: z.object({ kind: z.enum(['rule', 'document']), id: z.string().min(1).max(200), content_sha256: Sha, label: z.string().max(300) }).strict(),
    /** Empty: no clear match in this environment (flagged, never guessed). */
    environment_policy_ids: z.array(z.string().min(1).max(100)),
    reason: z.string().min(1).max(2000),
    /** Null until the owner confirms the entry; an unconfirmed entry is not sent. */
    confirmed_by: z.string().min(1).max(200).nullable(),
    confirmed_at: z.string().min(1).max(40).nullable(),
  })
  .strict();
const PolicyIdMap = z
  .object({
    environment: z.string().min(1).max(100),
    environment_version: z.number().int().min(1),
    /** The Studio template releases whose tasks run in this environment version. */
    applies_to: z.array(z.object({ studio_template_id: z.string().min(1), studio_version: z.number().int().min(1) }).strict()).min(1),
    source: z.string().max(500),
    environment_policies: z.array(EnvPolicy).min(1),
    entries: z.array(Entry),
  })
  .strict();
export const PolicyIdMaps = z
  .object({ schema: z.literal('praxis.policy-id-map.v1'), note: z.string().max(2000).optional(), maps: z.array(PolicyIdMap) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const m of v.maps)
      for (const a of m.applies_to) {
        const k = `${a.studio_template_id}@${a.studio_version}`;
        if (seen.has(k)) ctx.addIssue({ code: 'custom', message: `Two maps apply to ${k}.` });
        seen.add(k);
      }
  });
export type PolicyIdMap = z.infer<typeof PolicyIdMap>;
export type PolicyIdMapsFile = z.infer<typeof PolicyIdMaps>;

const loaded = PolicyIdMaps.parse(maps);

/** The mapping for a Studio template release (the environment version its tasks run in), or null when there is none. */
export function policyIdMapFor(ref: { id: string; version: number } | null, source: PolicyIdMapsFile = loaded): PolicyIdMap | null {
  if (!ref) return null;
  return source.maps.find((m) => m.applies_to.some((a) => a.studio_template_id === ref.id && a.studio_version === ref.version)) ?? null;
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
  const env = map ? `${map.environment}@${map.environment_version}` : '';
  for (const c of citedRules(record.output)) {
    const short = c.ruleId.slice(0, 8);
    const flag = (message: string) => unmapped.push({ ...c, message });
    if (!map) {
      flag(`S4 cites policy ${short}…, and there is no mapping to the benchmark environment's policy ids for this template version, so the agent's policy.read will not find it.`);
      continue;
    }
    const entry = map.entries.find((e) => e.forge.id === c.ruleId && e.forge.content_sha256 === c.contentSha256);
    if (!entry) {
      const otherVersion = map.entries.some((e) => e.forge.id === c.ruleId);
      flag(`S4 cites policy ${short}…${otherVersion ? ' at a version the mapping does not cover' : ''}, which has no mapping to ${env}'s policy ids, so the agent's policy.read will not find it.`);
      continue;
    }
    if (!entry.confirmed_by) {
      flag(`The mapping of policy ${short}… to ${env} is proposed and waits for the owner's confirmation, so it is not sent yet.`);
      continue;
    }
    if (!entry.environment_policy_ids.length) {
      flag(`Policy ${short}… has no clear match in ${env}: ${entry.reason}`);
      continue;
    }
    const missing = entry.environment_policy_ids.filter((id) => !declared.has(id));
    if (missing.length) {
      flag(`The mapping for policy ${short}… names ${missing.join(', ')}, which ${env} does not declare. Fix the mapping.`);
      continue;
    }
    mapped.push({ forge_rule_id: c.ruleId, forge_content_sha256: c.contentSha256, environment_policy_ids: [...entry.environment_policy_ids] });
  }
  return { mapped, unmapped };
}

/**
 * The `policy_id_map` of one task entry: {"<source id>": ["<env policy id>", …]} under `map`, with the environment
 * version and each named environment policy's content_sha256 (Studio's text_sha256), so the RL Gym applies it only to
 * the environment it was made for.
 */
export function policyIdMapWire(map: PolicyIdMap, mapped: MappedPolicy[]): Record<string, unknown> {
  const ids = [...new Set(mapped.flatMap((m) => m.environment_policy_ids))].sort();
  const sha = new Map(map.environment_policies.map((p) => [p.id, p.text_sha256]));
  // The RL Gym's accepted shape (fde41cf): environment_version "<key>@<n>", map, and policies with each content_sha256.
  // source_sha256 is an extra field the RL Gym ignores.
  return {
    environment_version: `${map.environment}@${map.environment_version}`,
    map: Object.fromEntries(mapped.map((m) => [m.forge_rule_id, m.environment_policy_ids])),
    policies: Object.fromEntries(ids.map((id) => [id, { content_sha256: sha.get(id)! }])),
    source_sha256: Object.fromEntries(mapped.map((m) => [m.forge_rule_id, m.forge_content_sha256])),
  };
}

export const POLICY_ID_UNMAPPED = 'POLICY_ID_UNMAPPED' as const;
