# Wave 3 test notes

For the owner's QA session once Wave 3 is deployed. Everything in `WAVE-1-TEST-NOTES.md` and `WAVE-2-TEST-NOTES.md`
still applies; this adds what is new. Wave 3 is built on the Wave 2 branch, so one QA deploy covers both.

New templates: Q4 global paid search query clustering (Digital Marketing) · Fraud-risk/compliance handoffs ·
Compliance monitoring (agent mode Single; field contracts marked "requires confirmation", gaps listed in
`TEMPLATE-PROFILES.md`, "Wave 3 profiles").

## 1. SME policy proposals
1. As an SME on a task, open **Propose a policy document** (above the task). Upload a synthetic policy (PDF, Word,
   text or Markdown), choose its kind (bank policy, customer policy, regulation, supporting reference), say why the
   task needs it, and tick the declaration. It shows **Waiting for review**. Upload the same file again: you are told
   it is already waiting (no duplicate).
2. Also try: an invoice or a marketing leaflet (flagged "may not be a policy"), a scanned PDF with no text (flagged
   unreadable), and a text containing a valid-looking IBAN (flagged as possible real data). None is rejected
   automatically.
3. As the project's Expert (assigned Validator), PM or an Admin open **Reviews → Task reviews → Policy documents
   proposed by SMEs** (`/review/policy-proposals`). Each proposal shows who proposed it and why, the file and its
   sha256, and Praxis's flags as advice. Download the original; show Praxis's reading (redacted when real data was
   suspected).
4. Decide: **Accept** (as a policy candidate or supporting reference), **Return to the SME**, or **Reject**, always
   with a reason the SME sees. An unreadable or possibly-real-data file cannot be accepted: return it. A second
   decision on the same proposal is refused.
5. After an accept, the document appears in the project's **Policy rules** page (origin "SME proposal"). The SME's task
   still shows no new rules: the PM must extract, review and publish them as for any document.

## 2. What SMEs and the chatbot see of policy
- The SME's rules panel, the chatbot's "Approved project rules" and the agent preview show only rules that are
  **published**, **agent-visible** and **in force today**. Evaluator-only rules and rules whose end date has passed are
  not shown to the SME or sent to the model. (Before Wave 3 the chatbot view also listed evaluator-only rules: fixed.)
- Pending, returned or rejected proposals never appear anywhere an SME, the model or the agent sees.

## 3. Policy sources on the review page
Open a submitted task in **Task reviews**: under the graph, **Policy sources** lists every rule the task is judged
against (frozen snapshot, or the current published set), each with its quoted source, document, version, page/line
and hash, evaluator-only rules labelled, rules not in force marked, the task's own rule changes and the steps the SME
linked. If the project published newer rules after the snapshot, the page says so.

## 4. Open model (Vertex MaaS)

**Status (12 Nov):** deferred. The Model Garden quota request is pending with Google, so QA stays on Gemini for this
session. Do the steps below once the quota is approved; skip this section until then.

The authoring chatbot can now run on a Vertex Model Garden managed open model (MaaS), alongside Claude and Gemini on
Vertex (handover chapter 11). It uses Vertex's OpenAI-compatible chat completions endpoint with the QA service
account's own Google credentials (no API key). Same system prompt, same proposal schema and validators, same daily
call cap (`AUTHORING_DAILY_CALL_CAP`), one call per answer with no automatic retry, and one `llm.call` log line per
call with `provider: "vertex-maas"` (tokens, including reasoning tokens, and latency; never prompt or answer text).
The default model does not change: QA stays on its current model until you switch.

**Recommended pilot model:** `gpt-oss-120b` (the cost-first candidate in chapter 11: USD 0.09 / 0.36 per million
input / output tokens, list price checked 10 Nov 2026). Compare it with **Gemma 4 26B A4B IT** in the same session.
`gpt-oss-20b` is cheaper on the pricing page but its MaaS endpoint retired on 21 Oct 2026: do not use it. (Note that
`MAAS-MODEL-AND-TOKEN-PLAN.md` puts Gemma 4 and DeepSeek-V4.1-Flash first; chapter 11 is the later plan.) No model has
been measured on Praxis yet; choose by cost per accepted task after the comparison, not by this recommendation.

### Before switching: enable it in the QA project (adi-praxis-test-0928)
1. Open Vertex AI → Model Garden → the model's card, and **enable** the managed (MaaS) API for it in
   `adi-praxis-test-0928`. Accept its terms only if you are content with them.
2. From the card, copy:
   - the **exact model id** for the OpenAI-compatible API, in the form `<publisher>/<model>` (for gpt-oss-120b
     expected to be `openai/gpt-oss-120b-maas`; use what the card says, not this guess);
   - a **supported region** (for example `us-central1`, or `global` if the card lists it).
3. Check: **licence** (gpt-oss: Apache 2.0; Gemma 4: Apache 2.0 per its model card; confirm on the Vertex card), **region and data processing**
   (where requests are processed), **quota** for the project and region (requests and tokens per minute), and
   **launch stage** (GA or Preview). Do not rely on the public catalogue for project availability.
4. The API/worker service account needs Vertex access (`roles/aiplatform.user`, as the Claude/Gemini path already
   uses); no API key is needed or accepted.

### Switching QA to it
Set on the QA API and worker services, then redeploy:
```
AUTHORING_MODEL=maas:openai/gpt-oss-120b-maas      # maas:<publisher>/<model>, exactly as on the card
AUTHORING_MAAS_LOCATION=us-central1                 # a region on the card, or global; blank = VERTEX_LOCATION
```
A value without `<publisher>/` is refused at start-up. To go back, set `AUTHORING_MODEL` to its previous value (for
example `gemini:gemini-3.8-flash`); task history is untouched.

Smoke check first (two small billed calls; does not change the deployment's setting):
```
pnpm --filter @praxis/api exec tsx --env-file-if-exists=../../.env scripts/vertex-smoke.ts \
  --authoring-model=maas:openai/gpt-oss-120b-maas --maas-location=us-central1
```
Exit 0 means the model answered with a valid proposal. HTTP 404 usually means the id or region is wrong or the model
is not enabled; 403 means the API or permission is missing; 429 means quota.

### What to check in the session
- **Admin → GET /admin/model-providers** shows `authoringChatbotVendor: "maas"`, `authoringChatbotProvider:
  "vertex-maas"`, the model id and its location.
- Run the same chatbot script you used for Claude/Gemini on a few templates: follow-up questions, proposals that only
  use your own wording, refusal to write answers for you, workflow changes, a policy citation. Note anything worse.
- A proposal the model returns in the wrong shape (or cut off) fails closed exactly as on the Gemini path: nothing
  is applied and the call is logged `ok: false` with `INVALID_OUTPUT` or `INCOMPLETE_OUTPUT`. Count these: chapter 11 asks for at least 99% valid results.
- Watch latency and the token counts in the `llm.call` log lines (reasoning tokens are billed as output).
