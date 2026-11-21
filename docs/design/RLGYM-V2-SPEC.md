# RL Gym v2: simplified specification

**Revision:** 1, 20 Nov 2026. **From:** Product Owner. **For:** whoever rebuilds RL Gym (Anvil).
**Status:** proposed. It builds on `docs/design/STUDIO-CHANGE-BRIEF.md` and the requirements log (TS-01 to TS-46).

RL Gym v2 does five jobs and nothing else. Templates, environments, images, domain packs, policy capture and
releases belong to the **Template Studio**. Projects, SMEs, authoring, review and task export belong to **ADI Forge**.
Both the template hash and the environment live in **one shared release registry** that the Studio writes and
everyone else reads.

---

## 1. Why a rewrite

Findings from a read-only review on 20 Nov 2026 of the RL Gym code QA actually runs: branch
`codex/open-weight-models-20261117` at `e49e149`, committed files only. The repo's default working branch
`codex/anvil-modern-workspace` is older and says it must not be deployed.

| Finding | Evidence |
|---|---|
| **Size far beyond the five jobs:** ~114k backend lines, ~405 API routes, 132 migrations, ~40k lines of web app | `services/backend/src/anvil` (471 files) |
| **Every domain is a hand-built pipeline:** Marketing alone is 153 files with v2/v3 copies; KYC is 65 | `marketing_*`, `marketing_native_private_sources{,_v2,_v3}.py`, `golden_kyc_*` |
| **Release state lives outside the repo:** QA runs services that are in neither `compose.yaml` nor `startup.sh` (`business-worker`, `golden-scheduler`, `golden-grader`, `native-coordinator`, `private-scoring-coordinator`) | Injected by `infra/gcp/qa_native_wiring.py:68-104` |
| **Two hashing schemes:** RFC 8785 for templates, `json.dumps(sort_keys)` elsewhere | `praxis_generic_contract.py:53-57` vs `db.py:15`, `dataset_export_contract.py:82` |
| **Qualification is tied to RL Gym's own code:** the receipt hashes ~100 RL Gym source files, so any code change invalidates receipts. It has no image digest and no policy hashes. | `praxis_template_source.py:9-185`, `praxis_template_registry.py:101-192` |
| **Hard-coded environment identity:** project `adi-anvil-mvp-2026`, repo `anvil-qa-v1`, a `KEY_STOP` date, a hostname check | `native_image_profile.py:8`, `praxis_template_client.py:16-30`, `network_observer.py:44` |
| **Live downloads during image builds** (OPA via `urlopen`, plus `npm ci` and `uv pip`) | `backend.Dockerfile:51`, `marketing-runtime.Dockerfile:53`, `private-evaluator-runtime.Dockerfile:7` |
| **Silent success:** the single-attempt runner exits 0 when its request is missing or already claimed | `golden_native_bridge.py:377-384, 468, 531-533` |
| **Health gates differ:** `deploy.sh` checks the web and harbor-worker containers; `startup.sh` checks only API health | `deploy.sh:190`, `startup.sh:98-106` |
| **No memory limits** on any service in the main compose file | `infra/gcp/compose.yaml` |
| **The task verifier is a no-op** (`tests/test.sh` is `true`) | `environment_harbor.py:766-773` |

**Worth keeping:** the container isolation is already right (`user 10001`, `read_only`, `network none`,
`cap_drop ALL`, no-new-privileges, CPU, memory and pids limits; `environment_harbor.py:724-760`). Graders already run
outside the task container. Model keys are reached through a host socket gateway, and the coordinator refuses to
start if API keys are present (`golden_native_bridge.py:531-536`). Images are already referenced by digest in most
places.

## 2. What stays, what moves, what goes

| Today (RL Gym) | Verdict | Goes to |
|---|---|---|
| `praxis_template_registry.py` (register, qualify, revoke, lookup) | **Keep the idea, rewrite** | Job 1. It reads Studio release manifests, and the receipt binds the release, not RL Gym's source. |
| `praxis_generic_contract.py`, `golden_kyc_v7_export.py` (the `praxis.authored-task-export.v1` validator) | **Keep, make generic** | Job 2. Today it is KYC-specific (`golden_kyc_policy_registry.py:85`). |
| `dataset_export*`, `praxis_case_dataset.py`, `benchmark_project_import.py` | **Keep, simplify** | Job 3 |
| `environment_harbor.py`, `harbor_worker.py`, `services/harbor` (Harbor 0.25 rollouts) | **Keep, simplify** | Job 4. Keep the isolation flags. |
| `golden_native_bridge.py` (file-based claim bridge) | **Replace** | Job 4, with a queue that claims exactly once and fails loudly |
| `evaluator_runtimes.py`, `evaluator_configurations.py`, `custom_python_executor.py`, `custom_python_grading.py`, `integrations/evaluators/promptfoo`, `benchmark_results.py`, `reports.py` | **Keep, repackage** | Job 5. Each evaluator becomes its own image pinned by digest (today Promptfoo, NeMo and OPA run inside the API image). |
| `praxis_generic_api.py` `/templates`, `/praxis/proposals`; `TemplateSetup.tsx`, `OfflineTemplatePublication.tsx` | **Move** | Studio (template proposal, publication, versioning) |
| `environment_cloud_build.py`, `environment_cloud_worker.py`, `environment_seeds.py`, `environment_validation.py`, `qa_initial_seed.py`, `Environment*` UI | **Move** | Studio (schema, seed, image build) |
| `policy_rules.py`, `kyc_policy_review*`, `golden_kyc_policy_*`, `contracts/praxis/project-policy-v1` | **Move** | Studio (policy capture and binding) |
| `SkillWorkflowBinding`, `workflow_*`, `campaign_semantic_*` | **Move or drop** | Studio (skills), if still needed |
| `marketing_*` (153 files), `golden_kyc_*`, `golden_*_paid_qualification` | **Drop** | Replaced by generic jobs 1 to 5 plus Studio domain packs |
| `praxis_template_client.py`, `praxis_template_delivery.py` (push proposals and receipts to ADI Forge) | **Drop** | Receipts are written to the shared registry instead |
| `praxis_contract.py`, `praxis_executable.py`, `task_imports.py`, `intake.py`, `import_*` (older wire formats, LLM-generated graders) | **Drop** | One export format only. Graders are evaluators pinned in the release. |
| `graph.py` (Neo4j), `factory.py`, `support.py`, `governed_ai_*`, `expert_reviews.py`, `workspace_editor.py`, `RevisionEditor` | **Drop** | Authoring and review belong to ADI Forge. Neo4j is not needed for the five jobs. |
| `runtime-checks/*`, `infra/gcp/qa_*_2026111x.py`, `artifacts/` | **Drop** | One-off operator scripts. Releases are declared, not scripted. |

## 3. The shared release registry

One registry, written only by the Studio and read by ADI Forge and RL Gym. RL Gym writes **only** receipts,
revocations and run manifests.

- **Store:** a GCS bucket, objects named by their SHA-256, retention lock on, versioning on. Images go in Artifact
  Registry with immutable tags, always referenced as `@sha256:…`.
- **Hashing:** RFC 8785 (JCS), then SHA-256, for every JSON object. Each hash field says what it covers (TS-02).
  Raw files are hashed as bytes. `json.dumps(sort_keys)` is not used anywhere.

```
registry/
  releases/<release_sha256>.json        # release manifest (Studio)
  templates/<template_sha256>.json      # full template spec (Studio)
  policies/<content_sha256>             # policy artifacts, exact bytes (Studio)
  packs/<pack_sha256>.json              # domain packs: core / region / process (Studio)
  receipts/<release_sha256>/<receipt_id>.json     # qualification receipts (RL Gym)
  revocations/<release_sha256>/<id>.json          # revocations (Studio or RL Gym)
  datasets/<dataset_sha256>.json        # evaluation dataset manifests (RL Gym; contents stay private)
  runs/<run_id>.json                    # run manifests (RL Gym)
```

**Release manifest** (written by the Studio):

```json
{
  "schema": "adi.release-manifest.v1",
  "release_id": "kyc-onboarding-refresh@8",
  "successor_of": "<release_sha256 of v7 or null>",
  "template": { "id": "6d8f9cae-…", "version": 8, "template_sha256": "8449adb0…",
                "part_hashes": { "requirement": "…", "authoring": "…", "execution": "…", "skills": "…" } },
  "environment": { "image": "<region>-docker.pkg.dev/<project>/releases/kyc-env@sha256:…",
                   "contract": { "health": "GET /health", "reset": "POST /reset", "snapshot": "GET /snapshot" },
                   "gate_result_sha256": "…" },
  "evaluators": [ { "kind": "promptfoo", "image": "…/evaluators/promptfoo@sha256:…", "config_sha256": "…" },
                  { "kind": "opa", "image": "…/evaluators/opa@sha256:…", "config_sha256": "…" } ],
  "policies": [ { "id": "us-31-cfr-1020.220", "content_sha256": "07069b75…", "kind": "official_text" } ],
  "packs": [ { "layer": "core", "id": "banking-core", "version": "1", "sha256": "…" },
             { "layer": "region", "id": "us", "version": "1", "sha256": "…" },
             { "layer": "process", "id": "kyc", "version": "1", "sha256": "…" } ],
  "case_selector": { "field": "product", "values": ["individual", "adult_joint", "teen_joint", "custodial"] },
  "approved_by": { "actor_id": "…", "role": "release_approver", "at": "…" },
  "content_classification": "synthetic"
}
```

`release_sha256` is the JCS SHA-256 of this object. The **template hash and the environment image digest live
together in it**, so nothing can pair a template with a different environment.

## 4. The five jobs

| # | Job | Trigger | Reads | Writes |
|---|---|---|---|---|
| 1 | **Qualify a release** | A new release appears in the registry | The release manifest; pulls the image by digest | `receipts/…` (pass or fail, checks run, expiry) or `revocations/…` |
| 2 | **Accept tasks** | ADI Forge export (`praxis.authored-task-export.v1`) | The package, plus the release it pins | Accepted or rejected with reasons; refuses unqualified or revoked releases |
| 3 | **Hold datasets** | An RL Gym operator adds a case set | Synthetic cases per case-selector value | `datasets/…` manifest (the hash covers the case records; contents stay private) |
| 4 | **Run rollouts** | Run request: release, task, cases, model | Release image by digest; task actor file | Trajectory, final DB snapshot, API trace (immutable, hashed) |
| 5 | **Grade and report** | Rollout finished | Snapshot plus the evaluators pinned in the release | Scores plus `runs/<run_id>.json` |

**Qualification receipt** (job 1):

```json
{ "schema": "adi.qualification-receipt.v1", "release_sha256": "…", "result": "qualified",
  "checks": ["image_pulls_by_digest", "contract_gate", "evaluators_resolve", "smoke_rollout"],
  "rlgym_version": "2.0.0", "issued_at": "…", "expires_at": "…", "issued_by": "rlgym-qualifier" }
```

The receipt binds the **release**, not RL Gym's source code. An RL Gym upgrade does not invalidate receipts, but
it may trigger re-qualification by policy.

**Run manifest** (job 5): `run_id`, `release_sha256`, `task_revision_id`, `dataset_sha256` and the case IDs used,
model ID and version, every image digest (environment and evaluators), each evaluator `config_sha256`, the
trajectory and snapshot hashes, scores per rubric criterion, and start and end times. A score can then be reproduced
from its manifest alone.

## 5. API (small)

| Method | Path | Job |
|---|---|---|
| POST | `/v2/releases/{release_sha256}/qualify` | 1 (also runs automatically when a release appears) |
| GET | `/v2/releases/{release_sha256}/receipt` | 1 |
| POST | `/v2/exports` (ADI Forge calls it; project-scoped, keyless identity, TS-16) | 2 |
| GET | `/v2/exports/{package_id}` | 2 |
| POST | `/v2/runs` (release, task, dataset, model) | 4 + 5 |
| GET | `/v2/runs/{run_id}` | 5 |
| GET | `/health` | all |

There are no template, proposal, environment-build, policy or authoring endpoints.

## 6. Runtime rules (from day one)

- **Task container:** `--network none`, `--read-only`, `--user 10001:10001`, `--cap-drop ALL`, no-new-privileges, CPU,
  memory and pids limits, tmpfs `/tmp` and `/workspace` only. No model keys. The model is reached only through the
  host socket gateway (0600/0660, `SO_PEERCRED`).
- **Evaluators:** each runs in its own container, pinned by digest, against the immutable post-rollout snapshot,
  never inside the task container.
- **Claims:** a queue with exactly-once claims (e.g. a Postgres `SKIP LOCKED` lease or Cloud Tasks). A missing or
  already-claimed request is an error with a non-zero exit code, never a silent 0.
- **Builds:** RL Gym's own images build hermetically: no `urlopen`, curl or wget; tools come from pinned base stages
  or vendored lockfiles. Base images come from the deployment project, set by `ARG`.
- **Deploy:** the whole topology is declared in one file (compose or Terraform), with a `mem_limit` on every service.
  The same health checks run in deploy and in startup. No host-mutating release scripts.
- **Config:** no hard-coded project, repo, hostname or date. Everything comes from environment configuration.
- **Data:** synthetic only (TS-44 is future scope). Authors never see datasets.

## 7. How to get there

1. **Freeze the old RL Gym.** Bug fixes only. No new domains.
2. **Stand up the registry** (bucket, retention, Artifact Registry repos) by Terraform. Import KYC v7, KYC v8 and
   Marketing VEYRA v1/v2 as the first releases, with their existing hashes.
3. **Build v2 jobs 1 and 2 first.** Acceptance test: qualify the KYC v8 release, accept the existing KYC v8 export
   ZIP (`ced49fec…`) unchanged, with the same result as the old RL Gym's runtime check.
4. **Build jobs 3 to 5.** Acceptance test: run the 4 KYC v8 tasks on a fixed dataset and model, twice, with identical
   run manifests apart from times and IDs.
5. **Marketing next** (run R2, live integration on, keyless export credential, TS-16).
6. **Switch over per template**, then retire the old RL Gym.

ADI Forge changes almost nothing. It keeps the same export format and reads receipts from the registry instead of
receiving pushed calls.

## 8. Open questions

1. Does Harbor 0.25 stay as the rollout engine, or is a thinner runner enough?
2. Is the RL Gym web app needed beyond run results and dataset admin? Most of today's ~40k lines are authoring and
   environment UI.
3. Who may add datasets (an RL Gym operator role), and who approves them?
4. When does a receipt expire, and does an RL Gym upgrade force re-qualification?
5. Are the external evaluator vendors in `evaluator_catalog.py` (Arthur, Openlayer, TruLens, Phoenix, Fiddler, LLM
   Guard) in scope for v2, or only Promptfoo, OPA and custom Python?
