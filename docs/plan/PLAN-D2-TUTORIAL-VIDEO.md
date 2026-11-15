# Plan: D2, AI-generated tutorial videos per template (15 Nov 2026)

Status: **plan only, awaiting the owner's approval.** No feature code is written until the owner says yes.
Decisions and assumptions are logged in `docs/DECISIONS.md` ("D2 tutorial videos: plan").

Source: row D2 in the MVP1 QA defect log. Owner decisions (15 Nov 2026): AI video with Vertex Veo; a missing video
never blocks publish; generation is part of publish in staging and production, and only an Admin button in QA; a
per-video cap and a daily cap; an Admin approves before SMEs or Reviewers see it; one-time cost per template version.

## 1. What the video contains

- **Chapter 1, Overview.** What the workflow is, what the SME produces, how it is reviewed. From the template's
  workflow name, primary work, verification criteria and human gate.
- **Chapters 2..N+1, one per form section**, in form order. For each field in the section: its label, whether it is
  required, what input it needs (from the field's own type, help text, pick-list values and limits), and what a good
  answer looks like, shown with a **synthetic example**.
- **Synthetic example source.** The template's own golden example where it has one (KYC v6/v7 golden task, the
  VEYRA golden Marketing example). Otherwise Gemini drafts one from the field definitions, marked synthetic, using
  only invented names (no real people, firms or customers). Nothing comes from tasks, SMEs or projects.
- **Public names.** Every word on screen or spoken goes through `publicText()` and a hard check for "Praxis",
  "Anvil" and "ADI-Labs" (case-insensitive). The product is "ADI Forge"; Anvil is "RL Gym". A hit fails the run;
  nothing is shown.

## 2. Pipeline

Runs in `praxis-worker` as an outbox handler (`template.tutorial_requested`), one run at a time per template lineage.

| Step | Service | Output |
|---|---|---|
| 1. Script | Gemini on Vertex, the existing QA route (`gemini:<model>` via `AUTHORING_MODEL` / new `TUTORIAL_SCRIPT_MODEL`) | Per chapter: narration (≤ 110 words, about 40 s), on-screen cards (field label, need, good example), and 2 Veo scene prompts. Zod-validated JSON. |
| 2. Clips | **Vertex Veo `veo-3.1-fast-generate-001`**, 720p, 16:9, **8 s**, video only (no Veo audio), 2 clips per chapter | MP4 bytes returned in the long-running operation (no `storageUri`, so no bucket IAM for the Vertex service agent). |
| 3. Narration | Cloud Text-to-Speech, one Chirp 3 HD English voice | One audio track per chapter. Veo audio is not used: it can't hold a 40 s narration in one voice. |
| 4. Stitch | `ffmpeg` in the worker image | One MP4 (H.264/AAC, 720p): per chapter the 2 clips, then the clip's last frame held under the text cards until the narration ends. Title card per chapter. MP4 chapter metadata, plus a WebVTT captions file from the narration. |
| 5. Store | GCS, private | `tutorials/<lineageId>/<runId>/tutorial.mp4` and `captions.vtt` in a new `TUTORIAL_BUCKET` (Terraform: `<project>-tutorials`, private, uniform access). |

- **On-screen text is ours, not Veo's.** Veo prompts ask for abstract, text-free office/workflow scenes: no
  readable text, no logos, no real people's likenesses, no documents with content. Field names and examples are
  drawn by ffmpeg from the validated script, so the wording is exact and checked.
- **Chapter markers** are written to `tutorial_chapters` as `[{ title, at }]` (seconds) when the video is approved.
  The task page's existing Tutorial card already jumps to them.
- **Serving.** `tutorial_video_url` stores `storage:tutorials/...` for a generated video. The API turns it into a
  V4 signed read URL (12 h) when it builds the task or template DTO, so the bucket stays private and the card's
  `.mp4` check still sees a video. A manually set URL (existing Admin field) works as before.
- **Failures.** Each Veo clip is retried once (safety filter or transient error). A step that still fails marks the
  run `FAILED` with the reason; the template, publish and any existing video are untouched.

## 3. Triggers

| Environment (`APP_ENV`) | On publish | Admin "Generate tutorial" button |
|---|---|---|
| staging, production | Yes: the publish transaction writes the outbox event. Publish never waits for, or fails because of, the video. A cap refusal is audited and shown on the template page. | Yes (regenerate) |
| demo (QA) | **No, never automatic** | Yes |
| local, test | No | Yes, with the mock generator |

Live calls also need `TUTORIAL_VIDEO_LIVE=true` and both caps set; otherwise the button explains why it's off. The
flag is refused in tests (config throws, like `POLICY_EXTRACTION_LIVE`).

## 4. Human approval

Run states: `QUEUED → SCRIPTING → CLIPS → NARRATION → STITCHING → READY_FOR_REVIEW → APPROVED | REJECTED`, or
`FAILED`. A newer approval marks the older approved run `SUPERSEDED`.

- Admin console, template page, new **Tutorial video** panel: Generate tutorial (with the cost estimate and today's
  spend shown first), the run's state, then for `READY_FOR_REVIEW` a preview player with chapters, captions and the
  script, and **Approve** / **Reject (reason)**.
- Only **Approve** writes `tutorial_video_url` / `tutorial_chapters`, on the run's template version and the later
  versions of that workflow (older versions keep their video). AI never approves.
- **Regenerating keeps the current approved video** on the task pages until the new one is approved.
- One live run per lineage (idempotency key `lineageId`; a second Generate returns the running one).

## 5. Cost

Price defaults (env, overridable): Veo 3.1 Fast 720p video only **$0.08 per output second** (Vertex pricing page,
Nov 2026); script and TTS allowance $0.05 per chapter (Gemini and Chirp 3 HD at ~600 characters a chapter cost
well under a cent; the allowance is deliberately high).

Per chapter: 2 clips × 8 s × $0.08 = $1.28, plus $0.05 = **$1.33**. With one retry allowed per clip, the reserved
worst case is $2.61 a chapter.

| Template | Chapters (overview + sections) | Expected | Worst case reserved |
|---|---|---|---|
| Marketing (VEYRA), 7 sections | 8 | ≈ $10.60 | ≈ $20.90 |
| KYC v6 / v7, about 10–12 sections | 11–13 | ≈ $14.60–$17.30 | ≈ $28.70–$33.90 |

All three templates once: about **$40–45**. Suggested values for the owner to set (not in `.env.example`):
`TUTORIAL_VIDEO_COST_CAP_USD=40`, `TUTORIAL_VIDEO_DAILY_CAP_USD=100`.

## 6. How the caps are enforced

- Env: `TUTORIAL_VIDEO_COST_CAP_USD`, `TUTORIAL_VIDEO_DAILY_CAP_USD` (blank = live generation refused),
  `TUTORIAL_VEO_MODEL` (default `veo-3.1-fast-generate-001`), `TUTORIAL_VEO_PRICE_USD_PER_SECOND` (0.08),
  `TUTORIAL_SCRIPT_MODEL` (empty follows a Gemini `AUTHORING_MODEL`), `TUTORIAL_TTS_VOICE`, `TUTORIAL_BUCKET`,
  `TUTORIAL_VIDEO_LIVE`. Names only in `.env.example`.
- **Before the run (request time):** estimate = chapters × worst case per chapter. Refused (409, audited
  `template.tutorial_refused`) if the estimate is over the per-video cap. Then, under a Postgres advisory lock, today's
  (UTC) spend for the whole environment = reservations of open runs + actual cost of finished runs; refused if that
  plus the estimate is over the daily cap. Otherwise a `reserve` row is written to the ledger in the same transaction
  as the run and the outbox event.
- **During the run:** before every Veo or TTS call the worker checks run-actual + this call ≤ per-video cap, and stops
  the run (`FAILED`, "cost cap reached") if not. Each billed call writes an `actual` ledger row.
- **After:** a `release` row returns the unused reservation.
- Ledger table `TutorialSpend` (runId, kind reserve/actual/release, amountUsd, createdAt) is append-only, enforced by
  a database trigger like the other ledgers.

## 7. Audit

`template.tutorial_requested` (trigger publish/admin, estimate), `template.tutorial_refused` (reason),
`template.tutorial_generated` (READY_FOR_REVIEW, actual cost, model, duration), `template.tutorial_failed`,
`template.tutorial_approved` and `template.tutorial_rejected` (Admin, reason), plus the existing
`template.tutorial_set` when the fields change. All state changes go through `runCommand` (authorised, idempotent).

## 8. Data model (one additive migration)

- `TemplateTutorialRun`: id, clientId, templateId, lineageId, trigger, status, model, script (JSON), chapters
  (JSON), objectKey, captionsKey, durationSeconds, estimatedUsd, actualUsd, error, requestedBy, decidedBy, decidedAt,
  rejectReason, timestamps. Partial unique index: one open run per lineage.
- `TutorialSpend` ledger (append-only trigger).
- No change to `Template` columns.

## 9. Tests (mocks only)

Script drafter, Veo client, TTS client, stitcher and storage are interfaces with mocks; no test calls Vertex, Veo
or TTS, and the ffmpeg step is mocked (one opt-in local test runs real ffmpeg on a 1 s generated clip when ffmpeg is
installed, skipped in CI). Acceptance tests:

1. Chapter plan: overview + one per section, in order, from the field definitions (KYC v6, v7, Marketing).
2. Banned names: a script with "Praxis", "Anvil" or "ADI-Labs" fails the run; `publicText()` applied.
3. Publish in staging/production enqueues a run; publish succeeds when the run fails or is refused.
4. Publish in demo/local never enqueues; the Admin button does.
5. Per-video cap refusal; daily cap refusal under concurrent requests; mid-run cap stop; release of unused reserve;
   ledger is append-only in the database.
6. Blank caps or live flag off: generation refused with a clear message; live flag in tests throws.
7. Approval: SMEs and Reviewers see nothing until Approve; reject keeps the old video; regenerate keeps the old video
   until the new approval; only ADMIN can generate/approve.
8. Audit rows for each state change; idempotent Generate.
9. Signed URL served for `storage:` videos; task page card plays it with chapters and captions (web + candidate
   component tests; one Playwright check with the mock).

## 10. Needs the owner (before any live run)

- Yes to this plan, and the two cap values (suggested $40 per video, $100 per day).
- DevOps (with the owner's yes): enable the Cloud Text-to-Speech API, create the tutorials bucket and grant the worker
  service account object write, add `ffmpeg` to the API/worker image, set the env values in QA.
- A live QA run of the three templates only on the owner's yes in their QA session.

## 11. Out of scope

Languages other than English; editing the script or chapters in the console (reject and regenerate instead);
per-task or per-project videos.
