import type { ApprovedTaskRecord } from '@prisma/client';
import { praxisContractIssues } from '@praxis/shared';
import { sha256, stableStringify } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { baseOf, recordContent, recordHash } from './approved-records';

/**
 * The exact `praxis.anvil.export.v1` payload and envelope for one approved record. The praxis-contract export and the
 * Anvil project policy manifest both use this, so a task binding's payload_sha256 is the export's, byte for byte.
 * Throws the export's own errors when the record has no valid contract or its hash does not verify.
 */
export function praxisExport(r: ApprovedTaskRecord) {
  const contract = (r.output as Record<string, unknown>).praxisContract;
  if (!contract) throw new AppError(409, 'NO_EXECUTABLE_CONTRACT', 'This record has no executable contract. Author a structured decision task first.');
  const issues = praxisContractIssues(contract);
  if (issues.length) throw new AppError(422, 'CONTRACT_INVALID', 'Export blocked: executable contract is invalid.', { issues });
  if (recordHash(recordContent(baseOf(r)), r.prevHash) !== r.contentHash) throw new AppError(409, 'RECORD_INTEGRITY', 'Export blocked: source record hash does not verify.');
  const payload = stableStringify(contract);
  const payloadSha256 = sha256(payload);
  const envelope = { schema_version: 'praxis.anvil.export.v1', source: { record_id: r.id, record_hash: r.contentHash, project_id: r.projectId, client_id: r.clientId, submission_time: r.submittedAt.toISOString(), reviewer_id: r.reviewerId, review_decision_time: r.reviewDecisionAt.toISOString() }, payload_json: payload, payload_sha256: payloadSha256 };
  return { contract: contract as { schema_version: string; task_id: string; task_version: string }, payload, payloadSha256, envelope };
}

export const hasExecutableContract = (r: { output: unknown }) => !!(r.output as Record<string, unknown> | null)?.praxisContract;
