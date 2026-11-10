# Turning on live policy extraction (LlamaExtract and Google) on staging

| Item | Value |
| --- | --- |
| For | Owner (preparation checklist) |
| Applies to | Policy Rules build (`feat/policy-rules`), staging only |
| Budget | $50 total: $20 LlamaExtract, $30 Google (owner decision D-B1) |
| Region | US: Document AI `us`, Gemini `us-central1` (owner decision A6) |

Until every step below is done, both providers show **Not available** in Praxis and authors use pasted text. Nothing is ever simulated. Never paste a key or password into a chat, an issue, a PR or a file in git.

## 1. What you prepare (before the build is deployed)

### 1.1 LlamaExtract (LlamaCloud, Pay as you go)

1. Sign in at https://cloud.llamaindex.ai with the company account (admin@adi-labs.ai is a good owner).
2. **Plan:** stay on **Pay as you go** (no subscription; 10,000 free credits each month). The smoke test needs a few hundred credits.
3. **Stop overspending:** Settings → Organization → Plan & Credits → **When credits run out** → choose **Pause jobs**. Do **not** turn on auto-reload or "Keep going, bill me for extra usage". If you buy a credit pack, buy the smallest (10,000 credits = $15).
4. **Project:** create a project named `praxis-staging`. Copy its **project ID** (not secret; send it to me).
5. **API key:** create an API key named `praxis-staging-extract`, scoped to that project if the screen offers it. Copy it once; you store it in step 2.2. Do not send it to me.

Send me: the LlamaCloud **project ID**, and confirm "Pause jobs" is set.

### 1.2 Google (Document AI + Gemini on Vertex AI)

Nothing to buy. Praxis signs in with its existing Cloud Run service account, so there is **no key**.

1. Make sure you can run Terraform for staging as before (`infra/README.md`), with the staging project, the `adi-praxis-staging-tfstate` bucket and your `terraform.tfvars`.
2. Optional but recommended: in Google Cloud Billing, add a budget alert of **$30** on the staging project filtered to the services "Document AI" and "Vertex AI".

Send me: nothing; just confirm you can run Terraform for staging.

## 2. What you run (infra PR #36, branch `infra/policy-docai`)

PR #36 only:
- enables `documentai.googleapis.com` and creates one Document AI **Layout Parser** processor in `us`;
- grants `roles/documentai.apiUser` to the worker service account (it runs extraction jobs; Vertex access already exists);
- creates the secret `llamaextract-api-key` **with no value**, readable by the api and worker only;
- adds the non-secret settings to `praxis-api` and `praxis-worker` with `live = false`. The LlamaCloud project ID is already in `envs/staging/main.tf`.

The app calls Document AI online with the file inline, so no bucket access is needed. The key is wired into Cloud Run only when `live = true`, because Cloud Run cannot start on a secret with no value.

### 2.1 Apply Terraform (staging)

```zsh
cd ~/praxis-staging-setup
git status --short   # must be empty; stash or commit local work first
git fetch origin && git switch infra/policy-docai
terraform -chdir=infra/terraform/envs/staging init
terraform -chdir=infra/terraform/envs/staging plan -out=policy.tfplan
```

The plan must read **`Plan: 6 to add, 4 to change, 0 to destroy.`** Create: 1 API service, 1 processor, 1 project IAM member, 1 secret, 2 secret IAM members. Update in place (new non-secret env vars only): services `praxis-api`, `praxis-worker` and jobs `praxis-migrate`, `praxis-verify-chains`. Anything else, or any destroy/replace: stop and send me the plan summary line. Then:

```zsh
terraform -chdir=infra/terraform/envs/staging apply policy.tfplan
```

### 2.2 Store the LlamaExtract key (zsh, key never shown or saved in history)

```zsh
read -rs "LLAMA_KEY?LlamaExtract API key: "; echo
printf %s "$LLAMA_KEY" | gcloud secrets versions add llamaextract-api-key --project adi-praxis-staging --data-file=-
unset LLAMA_KEY
gcloud secrets versions list llamaextract-api-key --project adi-praxis-staging --format='value(name,state)'
```

The last command shows `1 enabled` and never the key.

### 2.3 Switch live extraction on (only for the smoke test)

In `infra/terraform/envs/staging/main.tf`, change `live = false` to `live = true` in `policy_extraction`, then plan and apply again. That plan should only update the same four Cloud Run resources (live flag; the key reference is added to `praxis-api` and `praxis-worker` only). Production is never changed.

## 3. Seed the fictional projects (staging, after #35 is deployed)

Needs infra PR #37 applied (it lets the seed job store its documents). The seed refuses production.

1. Find two IDs. Sign in to the staging console **as the PM who should own the SEED projects** and open `https://<console host>/api/v1/auth/me`. Note `clientId` and `id` (the PM's user ID). Neither is secret. Replace the two placeholders below, keeping the quotes.
2. Run the seed (zsh):

```zsh
CLIENT_ID='paste-clientId-here'; PM_ID='paste-id-here'
gcloud run jobs execute praxis-migrate --region us-central1 --project adi-praxis-staging --wait \
  --args="src/jobs/run.ts,policy-seed,--client,$CLIENT_ID,--owner,$PM_ID"
```

3. Expected: 5 projects named `SEED — …` are created, each with a fictional policy document. Running it again creates nothing (it skips projects that already exist). If a project's workflow template is missing, that project is skipped and the job exits with code 3. Check the job log for `template missing`.

Your own test document is optional. Upload it on any SEED project's **Policy rules** page under **Policy documents**. Use fictional content only (no real client names or policy text), 20 pages at most, as PDF, DOCX, TXT or MD.

## 4. Enable a provider and run the smoke test

Live calls start only after guide 2.3 (`live = true`) is applied. Everything below is on one project's page: **Projects → SEED — Phone launch → Policy rules** (`/projects/<id>/policy`).

1. Sign in as an **Admin** and open the page. Under **Extract candidate rules**, expand **Admin: extraction profiles**. You will see `llama-agentic-v1` (deployment default), `llama-cost-effective-v1` and `google-layout-gemini-v1`, all unticked. Setup problems, if any, appear in orange beside each profile. There is no separate check button: an empty problem list means the settings and access are in place. Profiles are per client, so enabling one here enables it for every project.
2. Tick **Enabled** for `llama-agentic-v1` and `google-layout-gemini-v1`. Leave the cost-effective profile off.
3. **LlamaExtract run.** The line "Provider: … (set by …)" shows which profile this project uses (the deployment default is `llama-agentic-v1`). Under **Documents to extract**, tick `Phone launch marketing policy (fictional)` and click **Extract candidates**. Refresh after a minute. The **Receipts** table shows the document, status, number of candidates, profile with revision, and (for Admins) cost.
4. **Google run.** Click **Use for this project** next to `google-layout-gemini-v1`, then extract the same document again. Because the profile differs, this is a new attempt with its own receipt. Clicking **Extract candidates** again with the same profile and revision shows the existing receipt rather than calling the provider again.
5. **Rules:** candidates from both runs appear with quotes linked to the document. Nothing is marked Reviewed automatically; open one and check the source evidence beside it.
6. **Budget:** the Admin-only "Budget (provider): $x of $y used" line under the provider shows spend so far against the $20 / $30 limits. Each run reserves a worst-case estimate first (20 pages × $0.10 for LlamaExtract, × $0.03 for Google) and records the actual cost when it finishes.

Expected cost for a 1–2 page document is cents on Google, and a small part of your $75 LlamaCloud credit. That credit is paid, with no auto-reload and "Pause jobs" set.

## 5. Turning it off (rollback)

Any one of these stops new live calls immediately; existing records stay:
- untick **Enabled** for the profile under **Admin: extraction profiles** (fastest; affects every project), or
- set `live = false` in `envs/staging/main.tf` and apply Terraform (guide 2.3 in reverse), or
- revoke the key in LlamaCloud.

The app also refuses new jobs once their estimate would pass $20 (LlamaExtract) or $30 (Google).

## 6. Checklist to send back

| # | Item | Secret? |
| --- | --- | --- |
| 1 | LlamaCloud project ID | No — send it |
| 2 | "Pause jobs" set; no auto-reload | Confirm |
| 3 | LlamaExtract key created | **Never send** — store with 2.2 |
| 4 | You can run Terraform for staging | Confirm |
| 5 | Optional $30 Google budget alert | Confirm |
