# Demo videos

The demo videos follow one story through the platform. An Admin publishes a guidelines course. A PM opens a
requisition. A staffing partner puts Ravi forward and Asha applies directly. A Validator selects both. Asha writes a
KYC task with the AI interview, which a Validator accepts and then reviews again when RL Gym sends a result. Ravi
takes the course and certification test. Finance runs the week's pay run. Captions on screen explain each step;
there is no voiceover.

| Video | What it shows | Clips |
| --- | --- | --- |
| `00-full-walkthrough.mp4` | Every clip below, in story order | all |
| `01-getting-started.mp4` | Console sign-in, Home, the two-level menu, the Help button (Support Bot), partner and candidate sign-in pages | 01 |
| `02-admin.mp4` | Guidelines → generation → knowledge map, course, blueprint and item-family approval → publish a tier; partners, users, taxonomy, terms, failure codes, API keys | 02, 03 |
| `03-program-manager.mp4` | Six-step project wizard, Validators, opportunity page; requisition with guidelines and rate card; staffing; confirming a pay run | 04, 05, 10, 15b |
| `04-validator.mp4` | Deciding applications; reviewing and accepting a task; an RL Gym review and verdict | 08, 12, 13 |
| `05-finance.mp4` | Rate cards, earnings and holds, building, confirming, approving and submitting a pay run, reconciliation, partner statements | 15a, 15b, 15c |
| `06-staffing-partner.mp4` | Partner portal: requisition, submitting a candidate, tracking, statements, API & webhooks | 06 |
| `07-expert-sme.mp4` | Invite → sign-in → identity → profile chat → submit; onboarding; accepting work and writing a KYC task with the AI interview; course, test and payment set-up | 07, 09, 11, 14 |

**Things to know when watching**

- Everything the videos create is synthetic and named `[Demo video] …`, or uses the experts "Ravi Kumar" and "Asha
  Verma" with `@example.test` emails.
- Sign-in, identity, the selfie check, email and payouts are **simulated**, as in every test environment.
- The certification test answers are chosen by the script without knowing them, so Ravi's result is whatever those
  answers earn. A fail shows the retake rules.
- Asha applied directly to the opportunity rather than through a direct-pay requisition, so her accepted task earns
  nothing in the ledger. The pay run in the Finance video may therefore have no payments. This is the documented rule,
  not a defect.

## Where the files are

The scripts live in `e2e/demo-videos/`. Recordings are written to `out/demo-videos/` (not in git, because the files
are large):

- `out/demo-videos/*.mp4`: the finished videos (1440×900, H.264).
- `out/demo-videos/raw/*.webm`: one recording per clip.
- `out/demo-videos/state.json`: what the story created (ids, emails), for troubleshooting.

## Recording them again

Do this after a release changes the screens.

| Target | Command |
| --- | --- |
| Testers' environment (real Claude) | `e2e/demo-videos/run.sh` (needs `gcloud auth login`; passwords come from Secret Manager at run time) |
| Demo environment | `e2e/demo-videos/run.sh adi-praxis-demo-0927` |
| Local, fully mocked | `e2e/demo-videos/local-stack.sh` then `e2e/demo-videos/run.sh local`; stop with `e2e/demo-videos/local-stack.sh stop` |

To record one clip again, run `npx playwright test -c e2e/demo-videos --grep " 11 "`, then
`node e2e/demo-videos/make-videos.mjs`. Later clips use what earlier clips created (saved in `state.json`). A full run
takes about 30 minutes locally and longer on the test environment, where Claude writes the course and the task draft.

To add or change a caption, edit `c.say('…')` in `e2e/demo-videos/story.spec.ts`. To re-record with a human voice,
use the captions as the script.
