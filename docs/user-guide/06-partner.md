# 6. Staffing partner

Staffing partners put candidates forward for requisitions ADI Praxis opens to them, follow each candidate's progress,
and receive a fee for each candidate who becomes certified. **Partners never decide anything for a candidate**: ADI
Praxis invites each candidate, checks their identity and certifies them, and a person makes every selection.

You can work in the **partner portal** (this chapter) or through the **Partner API** (section 6.7).

## 6.1 Sign in

1. Open `<console address>/partner/login`. You see **"Sign in to the partner portal"**.
2. Enter **Work email \*** and **Password \*** → **Sign in**.

Your ADI Praxis partner manager (an Admin) creates your account and gives you the first password. If your company is
suspended you cannot sign in. "The partner portal is not switched on here" means SME supply is off in that
environment.

The portal menu: **Home**, **Requisitions**, **Candidates**, **Statements**, **API & webhooks**, and the **Help**
button.

## 6.2 Home

Tiles show open requisitions, candidates in progress, certified candidates and the latest statement. Select **See open
requisitions →** to begin.

> Candidates you submit in the portal are **live**: ADI Praxis emails them an invite. To test an integration without
> real people, use a sandbox API client (section 6.7).

## 6.3 Read a requisition

**Requisitions** lists roles open to you: tier, domain, headcount, how many you submitted ("n of max"), deadline and
state. Open one to read:

- **The role**: tier, domain, headcount, start, duration, hours, location, jurisdictions, languages, deadline, limit
  per partner, and **Who pays the expert** ("You pay your people" or "ADI Praxis pays the expert directly").
- **Minimum requirements**: years of experience, qualifications, and whether a professional licence is required.
- **Guidelines summary**: the topics to train your candidates on before you submit them.
- **Course outline**: the modules and the test length. Test questions and answers are never shared with partners.

## 6.4 Submit a candidate

Only put forward people who agreed to it and whom you trained on the guidelines summary.

1. On the requisition, select **Submit a candidate**. (It is hidden when the requisition is not open, the deadline has
   passed, or you reached the limit.)
2. Fill **Full name \***, Your reference (your own id; it appears on webhooks and statements), **Email \*** (the invite
   goes here), Phone, **Country \*** (two letters, e.g. IN), **Years of relevant experience \***, **Experience summary
   \*** (no ID numbers or customer data), Qualifications, Languages, and optionally employment history (**Add a role**).
3. Tick both confirmations: that you trained the candidate on the guidelines summary, and that the candidate agreed to
   be put forward and contacted.
4. **Submit candidate**.

You then see **"Candidate submitted"** with the invite expiry date and the **Requirement screen** result. The screen is
only a recommendation: "Only a Validator can decide that a candidate does not meet the requirements."

If the same person is already registered, you see "This candidate was not accepted." and the attempt is recorded on
your candidate list.

> **Test environment only:** email is simulated, so a yellow box **"Test environment: invite link"** shows the
> candidate's link. Open it in the candidate's browser profile and sign in with the **same email** you submitted.
> Production never shows this link.

## 6.5 Follow your candidates

**Candidates** lists everyone you put forward, with their state at each stage: Submission, Screen, Identity,
Selection, Certification and Standing. Open a candidate to see **Where they are now** and the full **History** (never
edited or removed).

**Withdraw candidate** is possible while the submission is Received or Invited. Their invite stops working, and nobody
can put the same person forward again for 90 days.

## 6.6 Statements

**Statements** shows one statement per month, with a fee line for each of your candidates certified that month under
your fee terms. A correction appears as a separate negative line. Payment is arranged outside the portal.

## 6.7 API and webhooks

**API & webhooks** is for your IT team.

- **API clients**: choose **Environment \*** (Sandbox: test data, no real candidates; Live: real candidates are
  invited) and **Scopes \*** (`requisitions:read`, `candidates:write`, `candidates:read`, `statements:read`) →
  **Create API client**. **The secret is shown once: copy it now.** **Rotate secret** and **Revoke** take effect at
  once.
- The API is at `/partner/v1`. Get a token from `POST /partner/v1/oauth/token` (client credentials) and send an
  `Idempotency-Key` header on submissions. Sandbox candidates never get email and do not appear in the portal.
- **Webhooks**: enter an HTTPS **Endpoint URL \***, the environment and the events → **Add webhook**. Each event is
  signed with HMAC-SHA256 (`Praxis-Signature` header) and retried until your endpoint returns 2xx. **Recent
  deliveries** shows the last 200; **Replay** sends one again with the same event id.
