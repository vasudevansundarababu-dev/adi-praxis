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

## 2. What you run (after I open the infra PR)

I will open a small PR on branch `infra/policy-docai`. Please review it. It only:
- enables `documentai.googleapis.com`;
- creates one Document AI **Layout Parser** processor in `us`;
- grants the backend service account `roles/documentai.apiUser` (Vertex access already exists);
- gives the Document AI service agent access to one private folder (`policy-docai/`) in the staging evidence bucket (needed for 16–20 page files);
- adds the secret name `llamaextract-api-key` (empty) and the non-secret settings below.

### 2.1 Apply Terraform (staging)

```zsh
cd ~/praxis-staging-setup
git fetch origin && git switch infra/policy-docai
terraform -chdir=infra/terraform/envs/staging init
terraform -chdir=infra/terraform/envs/staging plan  -var llamaextract_project_id=PASTE_PROJECT_ID
terraform -chdir=infra/terraform/envs/staging apply -var llamaextract_project_id=PASTE_PROJECT_ID
```

Check the plan shows only: one API, one processor, IAM bindings, one secret, Cloud Run env changes. Anything else: stop and tell me.

### 2.2 Store the LlamaExtract key (zsh, key never shown or saved in history)

```zsh
read -s "LLAMA_KEY?LlamaExtract API key: "; echo
printf %s "$LLAMA_KEY" | gcloud secrets versions add llamaextract-api-key --project YOUR_STAGING_PROJECT_ID --data-file=-
unset LLAMA_KEY
```

### 2.3 Switch live extraction on

In `infra/terraform/envs/staging/main.tf` the infra PR adds (off by default):

```hcl
policy_extraction = { live = false, budget_llama_usd = 20, budget_google_usd = 30, max_pages = 20 }
```

When you are ready for the smoke test, change `live = false` to `live = true` in that PR (or tell me to), then apply again. Production is never changed.

## 3. Turn it on in Praxis (after the staging deploy)

1. Sign in to the staging console as an **Admin**.
2. Go to **Admin → Extraction profiles**.
3. You will see `llama-agentic-v1` (default), `llama-cost-effective-v1` and `google-layout-gemini-v1`, each **Disabled / Not available**.
4. Click **Check** on each. It confirms settings and access **without** sending a document. Fix anything it reports.
5. **Enable** `llama-agentic-v1` and `google-layout-gemini-v1`. Leave the cost-effective profile disabled unless you want it.

## 4. Smoke test (I can run it with you)

1. Open the seeded project **SEED — Phone launch** → **Sources and Policies** → **Extract**.
2. Select the small fictional document `SEED Claims and brand policy (v1)`, click **Extract candidates**. The receipt shows the provider, profile revision, status and cost.
3. As Admin, run the same document again with the override **google-layout-gemini-v1**. It creates a second, separate attempt.
4. Open **Review Rules**: both attempts' candidates show quotes linked to the document. Nothing is marked Reviewed automatically.
5. Check **Admin → Extraction profiles → Spend**: two jobs, both well under $1.

Expected cost: a few cents (Google) and a few hundred LlamaExtract credits (covered by the free monthly credits).

## 5. Turning it off (rollback)

Any one of these stops new live calls immediately; existing records stay:
- **Admin → Extraction profiles → Disable** the profile (fastest), or
- set `live = false` and apply Terraform, or
- in LlamaCloud, revoke the `praxis-staging-extract` key.

Spend limits also stop new jobs automatically at $20 (LlamaExtract) and $30 (Google).

## 6. Checklist to send back

| # | Item | Secret? |
| --- | --- | --- |
| 1 | LlamaCloud project ID | No — send it |
| 2 | "Pause jobs" set; no auto-reload | Confirm |
| 3 | LlamaExtract key created | **Never send** — store with 2.2 |
| 4 | You can run Terraform for staging | Confirm |
| 5 | Optional $30 Google budget alert | Confirm |
