# 11 Google Vertex Model Garden: low-cost MaaS plan

Research checked 10 November 2026. This is a selection/implementation plan, not permission to enable billing or evidence of live account access. Google's current documentation also uses the name Gemini Enterprise Agent Platform for these services. Use the exact current model card and endpoint instructions, not an old copied ID.

## Recommendation

Use **gpt-oss-120b as the cost-first pilot candidate**, compare it with **Gemma 4 26B A4B IT**, and retain **DeepSeek-V4.1-Flash** as an additional challenger for cases that justify its cost. There is no measured Praxis quality winner yet. Choose the lowest cost per accepted, correctly facilitated task that passes the same safety/schema/grounding tests. Do not choose from a general coding leaderboard.

Google's current managed catalogue lists all three. MaaS is managed/serverless inference, so no dedicated GPU endpoint is required for this route. Open weights or an open model listing do not mean free hosted inference. This exercise does not require training or fine-tuning. Licence, region/data processing, quota and project availability must be checked before activation. [G1]

| Pilot candidate | Input USD / million | Output USD / million | Proposed role |
|---|---:|---:|---|
| gpt-oss-120b | 0.09 | 0.36 | Cost-first text facilitator pilot. |
| Gemma 4 26B A4B IT | 0.15 | 0.60 | Google open-model challenger for the same task suite. |
| DeepSeek-V4.1-Flash | 0.30 | 1.20 | Challenger where reviewed task results justify it. |

Prices are standard text list-price assumptions, excluding guaranteed cache discounts, taxes and negotiated terms. Google lists cheaper gpt-oss-20b pricing, but the MaaS retirement page says gpt-oss-20b-maas retired on 21 October 2026. Do not recommend an endpoint merely because it remains on a pricing page. Older Qwen3, DeepSeek V3.x/R1 and selected GLM endpoints have the same retirement issue. [G2-G4]

Google documents structured output for current managed open models. Treat that as syntax/schema capability, not evidence that the model preserves every existing field or cites a policy correctly. Always run the application validators. Implicit caching is model-dependent, Preview and not guaranteed; do not assume it for gpt-oss or deduct savings before measured usage. [G1, G5]

## Pilot before selection

Use 200 reviewed, authorised conversations distributed across the actual templates, including Classic-to-chat transitions, name/identifier contradictions, policy exceptions, evidence changes, unresolved human handoffs, rubric changes and rework. Add adversarial and off-topic cases; keep training/acceptance examples separate if model work is later authorised. Use the same task/schema/policies and output contract for each provider.

Proposed go/no-go gates: zero observed cross-tenant/private-answer leaks or forbidden approval/payment mutations; zero accepted unsupported substantive answers in the safety suite; at least 99% schema-valid results without silent repair; at least 95% expert-approved clarification/placement on the reviewed set; measured latency and dollar limits acceptable to the owner. These are proposed acceptance thresholds, not measured results or proof of zero future risk. Review failures by template; aggregate scores can hide a broken domain.

## Provider adapter steps

1. Verify Google Cloud project/API access, selected model card, permitted location, quota, launch stage, terms and data-processing requirements. Do not infer project availability from the public catalogue.
2. Use a backend service identity/ADC with scoped permissions. Never expose a cloud credential in SME code or ask an SME to paste an API key.
3. Implement a provider-neutral MaaS adapter behind ConversationAssistant. Translate strict response schema, allowed fields and refusal/error handling. Obtain the exact model ID/API shape from the current Google card; do not guess it from a display name.
4. Keep max output/time/cost and concurrency bounded. Existing Claude path has its own SDK contract; changing its model string is not an open-model adapter.
5. Record request/run IDs, model version, template/task/policy revision, usage input/output/reasoning/cache tokens and outcome. Avoid raw private text in telemetry.
6. Preserve claim-once jobs and human confirmation. Classify timeout/unknown completion as uncertain; no automatic duplicate paid attempt. An explicitly authorised retry is a new linked attempt.
7. Qualify with mock HTTP contracts, then an owner-authorised small live pilot. Compare expert judgement and measured cost. Roll back provider configuration without rewriting task history.

## Token budget for 100,000 accepted tasks

Planning assumptions: all tasks use chat; 20 calls per original task; average 10,000 input and 1,000 billed output tokens per call; 25% allowance for rework, abandoned work and repairs. Total: 25,000 million input plus 2,500 million output = 27,500 million tokens. Count repeated context on every request, not just new words. Billed reasoning and attempted/invalid model outputs must be included according to the selected model's receipts.

At those assumptions gpt-oss-120b authoring inference is USD 3,150 total, or USD 630/month over five equally busy authoring months. Gemma is USD 5,250 total; DeepSeek is USD 10,500. These are arithmetic scenarios, not measured bills or equivalent quality. Six-month hosting averages must not be confused with five active authoring months. Classic-only work has no conversational inference; Both costs according to actual chat use, not double by definition. If only 40% of accepted tasks use this chat workload, multiply the authoring estimate by 0.4.

Extraction, OCR, embeddings, storage, app hosting, benchmark models/environments and labour are separate. Full benchmark execution across models/environments/repeats multiplies execution costs; it is not included in this chatbot estimate. Budget without cache savings. Start with a small pilot and replace these assumptions with median/p90 tokens and cost per accepted task before funding the 100,000-task scale.

## Official sources

G1: Managed open models and caching: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/use-open-models
G2: Partner/open-model pricing: https://cloud.google.com/model-garden/partner-models/pricing
G3: Gemma pricing: https://cloud.google.com/model-garden/pricing
G4: Endpoint retirement: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deprecations/open-models
G5: Structured outputs: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/capabilities/structured-output

No current-source statement here proves source licensing suitability, account-region access or production quality. Recheck the cited pages and actual model card at activation; prices and availability can change.
