# Wave 3 test notes

For the owner's QA session once Wave 3 is deployed. Everything in `WAVE-1-TEST-NOTES.md` and `WAVE-2-TEST-NOTES.md`
still applies; this adds what is new.

## Open model (Vertex MaaS)

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
