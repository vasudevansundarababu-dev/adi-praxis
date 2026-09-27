// RL Gym (machine client). Use curl or Postman against the API URL with: Authorization: Bearer <RL Gym key>
// and, on POST, Idempotency-Key: <a new UUID>. Keys come from Admin → API clients (TC-ADM-007).
const c = (id, title, o) => ({ id, title, persona: 'RL Gym', ...o });

export const CASES = [
  c('TC-RLG-001', 'Send a review request', {
    category: 'FUNC', priority: 'P1', pre: 'An RL Gym key; an accepted record id.',
    steps: ['POST /api/v1/integrations/rl-gym/review-requests with samples/rl-review-request.json (your record id in source_record_ids).'],
    expected: ['201 with the request id; it appears under RL reviews for the project\'s reviewers.'],
    decisions: ['D-M7-01'],
  }),
  c('TC-RLG-002', 'Duplicate request returns the existing one', {
    category: 'FUNC', priority: 'P1', pre: 'TC-RLG-001 done.',
    steps: ['Send the same body again with a new Idempotency-Key.'],
    expected: ['200 with the same id; no second review appears.'],
    decisions: ['D-M7-01'],
  }),
  c('TC-RLG-003', 'Invalid requests are refused with reasons', {
    category: 'FUNC', priority: 'P2', pre: 'An RL Gym key.',
    steps: ['Send: no eval_results; a source_record_id that does not exist; a non-UUID id; 101 eval results; a missing Idempotency-Key.'],
    expected: ['Each gets a 4xx with a message naming the problem; nothing is created.'],
    decisions: ['D-M7-01', 'D-PL-06'],
  }),
  c('TC-RLG-004', 'Pull results', {
    category: 'FUNC', priority: 'P1', pre: 'A submitted RL verdict (TC-REV-020).',
    steps: ['GET /api/v1/integrations/rl-gym/results.', 'GET again with ?after=<last seq>.'],
    expected: ['The verdict, metric verdicts and comments are returned; the second call returns only newer results.'],
    decisions: ['D-M7-03'],
  }),
  c('TC-RLG-005', 'Read the dataset with the RL Gym key', {
    category: 'FUNC', priority: 'P2', pre: 'An RL Gym key.',
    steps: ['GET /api/v1/dataset/records, /dataset/export, /dataset/records/<id>/replay, /mcp/kyc/tools.', 'POST /api/v1/dataset/records/<id>/corrections.'],
    expected: ['All GETs succeed; the correction is refused (401/403).'],
    decisions: ['D-M6-02', 'D-M9-13'],
  }),
  c('TC-RLG-006', 'Wrong or missing keys', {
    category: 'SEC', priority: 'P1', pre: 'None.',
    steps: ['Call the review-requests endpoint with no key, a made-up key, a CLIENT_API key, and a revoked RL Gym key.'],
    expected: ['401 for missing, made-up and revoked keys; 403 for the wrong kind of key.'],
    decisions: ['D-M5-10'],
  }),
  c('TC-RLG-007', 'Replay an accepted task through MCP', {
    category: 'FUNC', priority: 'P2', pre: 'An accepted KYC task\'s record id.',
    steps: ['GET /api/v1/dataset/records/<id>/replay.', 'For each call in "calls", check request.params.arguments is valid for the tool\'s inputSchema in "tools".'],
    expected: ['Every call has method "tools/call"; arguments match the schema; results have content[0].type "text" and isError false (true only for kind ERROR).'],
    decisions: ['D-M9-11', 'D-M9-13'],
  }),
];
