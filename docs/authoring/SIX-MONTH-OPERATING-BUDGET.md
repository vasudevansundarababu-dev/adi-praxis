# Six-month Anvil + Praxis operating budget

Planning date: 10 November 2026. USD, excluding development labour, model training, taxes and development/test environments. Include application hosting, chatbot inference, benchmark-model inference and benchmark sandbox compute. These are estimates, not a current GCP billing report, capacity qualification or authority to provision or spend.

## Workload held constant
100,000 tasks authored in the first five months; both applications remain hosted for six months. The sixth month adds hosting, not another assumed 20,000 tasks. Benchmark planning case: each task executed once against one model in one environment with one repetition. A run means a task execution, not a project or benchmark batch.

Application hosting: a lean single-region setup with small separate application/database resources, bounded workers, backups, object storage and controlled logs/network traffic. No self-hosted model GPUs, no always-running trial VMs, no HA database replicas and no second permanent staging estate. Hosting planning allowance: **$400/month, $2,400 across six months**; practical preliminary range $300-$550/month until resources and traffic are measured. This excludes variable sandbox compute below.

Basis: [Cloud SQL prices](https://cloud.google.com/sql/pricing), [Cloud Run prices](https://cloud.google.com/run/pricing), [Compute Engine pricing](https://cloud.google.com/products/compute/pricing). Hosting allocations are our estimates, not Google package prices. The existing local previews are not evidence of a production cloud bill.

## Low-cost model planning assumptions
Praxis: 20 model calls per task, average 10,000 input and 1,000 billed output tokens/call; 25% allowance for rework/extra calls. Across 100,000 chat-using tasks this is 25,000M input and 2,500M output. At current gpt-oss-120b MaaS list rates ($0.09/M input and $0.36/M output), **$3,150 total**. No guaranteed cache discount assumed. Classic tasks contribute no conversational facilitation calls. BOTH is charged by actual usage, not by enabling two tabs.

Anvil: assumed 50,000 input + 5,000 billed output tokens per execution at the same low-cost rates: **$0.0063/execution; $630 for 100,000 executions**. This is only an illustrative inexpensive benchmark model. Premium models, judges, long tool transcripts, reasoning tokens and retries increase this amount.

Sandbox: assumed 10 VM-minutes/execution on a small CPU worker, budgeting a rounded **$0.08/VM-hour**, including an allowance above the approximate basic compute rate for idle/startup overhead. 100,000 executions consume about 16,667 VM-hours: **approximately $1,340**. This is a workload/rate assumption, not proof the six Harbor environments fit that worker size or finish in ten minutes. Bigger images, separate verifier resources, idle pools, disks and slower runs require re-estimation. No GPU inference is included.

Model rates: [Google managed partner/open-model pricing](https://cloud.google.com/model-garden/partner-models/pricing). See MAAS-MODEL-AND-TOKEN-PLAN.md for scenarios and qualification limits.

## Six-month scenarios

| Component | All 100k tasks use chat; benchmark all once | 25% of tasks use chat; benchmark all once | 50% use chat; benchmark a 10k sample once |
|---|---:|---:|---:|
| App hosting, six months | $2,400 | $2,400 | $2,400 |
| Praxis chatbot | $3,150 | $788 | $1,575 |
| Anvil model calls | $630 | $630 | $63 |
| Anvil CPU sandboxes | $1,340 | $1,340 | $134 |
| Subtotal | $7,520 | $5,158 | $4,172 |
| Contingency | $1,504 (20%) | $774 (15%) | $834 (20%) |
| Six-month budget | **$9,024** | **$5,932** | **$5,006** |
| Average/month | **$1,504** | **$989** | **$834** |

These are scenario outputs, not guaranteed bills. Active-month spending can exceed the six-month average. For the first column, the subtotal in each of the first five months is about $1,424; month six hosting is $400, before contingency. A strict $1,000/month cap needs monthly scheduling and measured usage, not merely a six-month total below $6,000.

## Interpretation
For full chat usage and benchmarking every task, plan approximately **$1,500/month or $9,000 over six months** under the inexpensive-model assumptions. A $1,000/month target is possible with substantially lower chat use, sampled benchmark execution, shorter runs or proven efficiencies; it is not safe to promise full unrestricted usage at that cap.

Benchmark executions = selected tasks x models x environments x repetitions, plus retries. Three models, two environments and two repetitions create 12 executions per task: both sandbox time and model calls scale, and prices differ by model. Authoring 100,000 tasks does not require immediately running every model against every task.

To target a real cap, meter tokens and sandbox minutes, set per-project monthly limits and concurrency/worker lifetime limits, retain artifacts with explicit expiry, avoid idle GPU servers and use bounded evaluation samples during development. Budget alerts alone are not spending stops. No such cap, cloud deployment or paid provider has been enabled by this estimate. Confirm actual execution duration, selected models and per-task token receipts before committing to a bill ceiling.
