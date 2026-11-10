# Open-model MaaS choice and token planning for Praxis

Research date: 10 November 2026. This is a planning estimate, not measured production consumption or approval to enable paid calls.

## Cost-first clarification

The owner clarified that "open source" meant free usage and that no model training is planned. Vertex MaaS is paid hosted inference even when weights are freely downloadable. The comparison below therefore prioritises low cost per completed task; none of the paid estimates should be described as free. Credits or limited promotional access are not assumed.

## Recommendation
Evaluate **Gemma 4 26B A4B IT** and **DeepSeek-V4.1-Flash** first on Praxis conversations, with **gpt-oss-120b** as the lower-price text-only challenger. GLM-5.2 is an additional complex-workflow challenger; do not pay its higher price without evidence of lower rework or materially better extraction. No model has been measured as the best-performing Praxis facilitator yet.

This chatbot must organise SME-authored content, maintain the structured task, identify missing information and cite approved project rules. It must not write substantive answers, invent evidence or policies, approve tasks or infer misconduct. A coding or general reasoning leaderboard does not measure those requirements. Application controls and human acceptance remain mandatory with every model.

Google lists these models as managed serverless MaaS offerings: Gemma 4 26B A4B IT, DeepSeek-V4.1-Flash, GLM-5.2, gpt-oss-120b and Llama 4 Scout/Maverick. Finding a model elsewhere in Model Garden does not guarantee managed MaaS availability. Claude 3.5 Sonnet and GPT-4o are proprietary/closed-weight; gpt-oss is a distinct OpenAI open-weight family. Open weights and a fully open training pipeline are different claims.

Sources: [managed open-model catalogue](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/use-open-models), [Gemma 4 model card and Apache 2.0 licence](https://ai.google.dev/gemma/docs/core/model_card_4), [DeepSeek MaaS specifications](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/deepseek/deepseek-v41-flash), [official gpt-oss documentation](https://developers.openai.com/api/docs/models/gpt-oss-120b).

DeepSeek's current Google endpoint documents structured output/function calling, Preview launch status and global processing. Validate account access, regional requirements and operational suitability before selection. Do not promise service guarantees from model-family capabilities. Several older Qwen, DeepSeek and GLM endpoints are listed as retired as of 21 October 2026; an old pricing row is not proof of an available endpoint. [Retirement register](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deprecations/open-models).

## What to measure before declaring a winner
Run the same 300-500 reviewed conversations spanning the templates: clean input, ambiguous policy, changed earlier answer, conflicting evidence, long history, unsupported requests and injected document instructions. Measure field extraction accuracy, untouched-field preservation, fabricated facts/rules, valid schema/IDs, useful next question, refusal of answer-writing, latency, accepted completion rate and actual cost per accepted task. Use fresh conversations and a held-out acceptance set. This evaluation needs an explicit paid-call budget; none has been run here.

Proposed gates: zero critical unauthorised changes in the test set, at least 99% schema-valid first responses, and expert-reviewed extraction/clarification thresholds agreed before testing. These are targets, not measured results or a statistical guarantee of zero future failures.

## 100,000 accepted tasks in five months
Assume all tasks use chat, text inputs, policy excerpts retrieved from a project library and no benchmark-agent execution. Count every request's full input, including re-sent context; do not count only the newly typed words. Output includes structured patches and any billed reasoning. The extra 25% below is a planning allowance for rework, abandoned work, repairs and additional calls; its true value needs a pilot.

| Scenario | Calls per initial task | Mean input per call | Mean billed output per call | Input, including 25% allowance | Output, including allowance | Total |
|---|---:|---:|---:|---:|---:|---:|
| Lean | 12 | 4,000 | 500 | 6,000M | 750M | 6,750M |
| Planning case | 20 | 10,000 | 1,000 | 25,000M | 2,500M | 27,500M |
| Long/complex | 35 | 20,000 | 1,500 | 87,500M | 6,562.5M | 94,062.5M |

Planning case: 250,000 input + 25,000 output tokens per accepted task after the allowance. Across five months: **27.5 billion tokens**. At a flat 20,000 accepted tasks/month: **5.5 billion tokens/month** and approximately 500,000 model calls/month. Delivering the same volume in three months changes rate/month, not the total under unchanged assumptions.

This is an inference budget. It excludes training, benchmark execution, OCR, embeddings, vector storage, hosting, observability and labour. Classic-only tasks contribute no conversational facilitation tokens. If 70% of tasks actually use chat, the planning estimate becomes 19,250M tokens, assuming other factors unchanged. BOTH is not twice the cost; usage determines calls.

## Current list-price calculation, no cache savings assumed
USD per million tokens, checked on the research date. Cost = input millions x input rate + output millions x output rate. Rates and model availability may change over the five-month horizon. Tokenisation, reasoning and repair rates vary by model, so the same token assumption is an illustrative comparison rather than a measured bill.

| Model | Input / M | Output / M | Planning case, five months | Per month at flat volume |
|---|---:|---:|---:|---:|
| gpt-oss-120b | $0.09 | $0.36 | $3,150 | $630 |
| Gemma 4 26B | $0.15 | $0.60 | $5,250 | $1,050 |
| DeepSeek-V4.1-Flash | $0.30 | $1.20 | $10,500 | $2,100 |
| GLM-5.2 | $1.40 | $4.40 | $46,000 | $9,200 |

Sources: [Google model pricing](https://cloud.google.com/model-garden/pricing), [Google partner/open-model pricing](https://cloud.google.com/model-garden/partner-models/pricing).

Cache pricing must be applied to a measured cache-hit portion of input only. It does not reduce logical tokens processed. Google documents implicit caching for selected open MaaS models with 90% discounted cached input, a 4096-token minimum and no guaranteed hits; this is Preview. Budget without guaranteed savings, then use actual cached-token receipts. [Caching details](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/use-open-models).

## Cost controls - no model training in scope
Keep one durable structured case and relevant approved policy excerpts in context, with bounded recent dialogue and carefully validated memory. Repeatedly sending a whole 20-page policy on every turn multiplies input spend. Project-level extraction/indexing should be reused across tasks. Send small typed patches where safe; the current complete-section proposal format may cost more than the lean assumption. Log input/output/reasoning/cached tokens, failures, attempts and accepted-task linkage; report dollars per accepted task by template and provider.

Start with a small reviewed pilot and replace these assumptions with median and p90 measurements. No fine-tuning, custom-weight serving or training budget is planned for this exercise. Retain task and review provenance for audit, subject to project rights and retention, without treating it as permission to train.
