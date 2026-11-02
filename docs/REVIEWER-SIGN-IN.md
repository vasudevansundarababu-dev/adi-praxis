# Hosted reviewer access

Verified browser entry points on 2 November 2026 (America/Chicago):

- [Praxis console](https://praxis-web-yu2jtyqhea-uc.a.run.app/).
- [Praxis candidate sign-in](https://praxis-candidate-yu2jtyqhea-uc.a.run.app/sign-in).
- [Anvil workspace](https://anvil-34-36-217-66.sslip.io/workspace).

The console opened Home using an existing authenticated Admin session and displayed
build `demo-a03cb10d-20261102`. The candidate sign-in page displayed that same build
and explicitly labeled simulated Google/identity and synthetic-only demo data. This
is an entry-point check, not a newly performed first-login or live-provider test.

## Console steps

1. Open the console and use your assigned account when prompted. An existing session
   may open Home immediately. Credentials are provided privately, never in this guide.
2. If issued a temporary password, choose your own through the required first-sign-in
   flow. Do not share that password or a screenshot of its one-time display.
3. Start with Projects, Reviews and Approved exports. See the [module guide](MODULE-GUIDE.md)
   for definitions, distinctive features and limitations.

## Contributor steps

The candidate application is a separate audience. Its hosted demo sign-in form contains
Email, Name and **Continue with Google (mock)**, plus an age confirmation and terms/privacy
notices. Use fictional demo data, personally review any agreement, and follow the visible
onboarding checklist. Demo identity is simulated; do not enter actual identity documents
or customer information. No candidate account was created by this verification.

## Continue in Anvil

Download an approved supported task export in Praxis, then open Anvil with your assigned
Anvil/Keycloak account and project. Importing does not grant Anvil data-processing rights
or spending authority. Inspect validation/readiness and exact configuration before Run.
Anvil requires an Admin sign-in within ten minutes for budget authorization; when prompted,
sign out/in and return to the same saved draft. Never replay an already-started unknown run.

The existing deployments preserve users and historical records. The earlier
[YC release evidence](YC-REVIEW.md) is dated; its first-release build is not a claim that
the current default Git branch or every later commit is deployed. Hosted demo configuration
uses real configured Vertex AI and simulated candidate sign-in/identity/email. Live payout
and production identity readiness are separate and are not established here.
