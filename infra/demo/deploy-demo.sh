#!/usr/bin/env bash
# Deploys a click-through DEMO of ADI Praxis to a new Google Cloud project named "ADI Praxis".
#
#   infra/demo/deploy-demo.sh <project-id> <billing-account-id> [region]
#
# Demo only: production builds with the local mocks (simulated Google sign-in and identity check, rule-based AI,
# in-memory email), synthetic data, the default *.run.app URLs. It is not the staging/production path (that is the
# Terraform in infra/terraform plus GitHub Actions). Re-running is safe: existing resources are reused, new images
# are built and deployed. Remove everything with: gcloud projects delete <project-id>
#
# Options (environment variables):
#   PRAXIS_VERTEX=1        Real Claude and embeddings on Vertex AI (the testers' environment); sign-in, identity
#                          check and email stay simulated. Claude must be enabled for the project in Model Garden.
#                          Also sets the authoring chatbot model and daily cap (AUTHORING_MODEL, default
#                          gemini:gemini-3.8-flash until Claude quota is granted, then claude-sonnet-5-5;
#                          AUTHORING_DAILY_CALL_CAP, default 300) and deploys, but never runs, the
#                          praxis-vertex-smoke job.
#   PRAXIS_SME_SUPPLY=1    Switch on M10 SME supply (partners, certification, payments; docs/SME-SUPPLY.md) in the API,
#                          worker, console and candidate app, and add its test data (Finance user, a partner with a
#                          portal login, a rate card and an open requisition).
#   PRAXIS_ENV_LABEL=...   Banner label, e.g. "Test environment" (default "Demo environment").
#   PRAXIS_NAME=...        Project display name when the project is created (default "ADI Praxis").
#   PRAXIS_BUILD=...       Build label shown in the banner and at /api/v1/version (default <commit>-<time>).
#   DEPLOY_ONLY=1          Nightly redeploy: skip project, network, database, Redis and secret setup (they must exist);
#                          build, migrate and deploy only, and never print passwords (used from GitHub Actions).
set -euo pipefail

PROJECT_ID=${1:?project id, e.g. adi-praxis-demo-1234}
BILLING=${2:?billing account id (gcloud billing accounts list)}
REGION=${3:-us-central1}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
COMMIT=$(git -C "$ROOT" rev-parse --short HEAD)
TAG=$COMMIT-$(date +%s)
BUILD=${PRAXIS_BUILD:-$TAG}
ENV_LABEL=${PRAXIS_ENV_LABEL:-Demo environment}
VERTEX=${PRAXIS_VERTEX:-}
SME_SUPPLY=${PRAXIS_SME_SUPPLY:-}
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }
# New service accounts take a little while to become visible to IAM; retry policy changes for up to ~2 minutes.
retry() { for i in $(seq 1 12); do "$@" >/dev/null 2>&1 && return 0; sleep 10; done; "$@"; }

if [ -z "${DEPLOY_ONLY:-}" ]; then
say "Project $PROJECT_ID (${PRAXIS_NAME:-ADI Praxis})"
exists gcloud projects describe "$PROJECT_ID" || gcloud projects create "$PROJECT_ID" --name="${PRAXIS_NAME:-ADI Praxis}"
# Link billing only when needed: re-linking an already linked project can fail with FAILED_PRECONDITION.
[ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)')" = "billingAccounts/$BILLING" ] ||
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING" >/dev/null
gcloud config set project "$PROJECT_ID" >/dev/null
PNUM=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

say "Enabling APIs (a few minutes the first time)"
gcloud services enable run.googleapis.com sqladmin.googleapis.com redis.googleapis.com compute.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com storage.googleapis.com \
  iam.googleapis.com logging.googleapis.com
[ -n "$VERTEX" ] && gcloud services enable aiplatform.googleapis.com

say "Network"
# New projects usually get the default network automatically, shortly after the Compute API is enabled.
for _ in $(seq 1 20); do exists gcloud compute networks describe default && break; sleep 6; done
exists gcloud compute networks describe default || gcloud compute networks create default --subnet-mode=auto

say "Service account"
SA=praxis-demo-run@$PROJECT_ID.iam.gserviceaccount.com
exists gcloud iam service-accounts describe "$SA" || gcloud iam service-accounts create praxis-demo-run --display-name="ADI Praxis demo runtime"
for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/logging.logWriter roles/monitoring.metricWriter; do
  retry gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$role" --condition=None
done
# Claude and embeddings on Vertex AI for the runtime (testers' environment).
[ -n "$VERTEX" ] && retry gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role=roles/aiplatform.user --condition=None
# Cloud Build pushes images with the default compute service account.
for role in roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
  retry gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$PNUM-compute@developer.gserviceaccount.com" --role="$role" --condition=None
done

say "Evidence bucket"
BUCKET=$PROJECT_ID-demo-evidence
exists gcloud storage buckets describe "gs://$BUCKET" || gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
retry gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectAdmin

say "Secrets"
secret() { # name value (only created once; values are never printed except the demo logins at the end)
  if ! exists gcloud secrets describe "$1"; then
    printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic >/dev/null
  fi
}
rand() { openssl rand -hex "${1:-16}"; }
secret db-password-migrator "$(rand)"
secret db-password-app "$(rand)"
secret mock-secret "$(rand 32)"
secret demo-admin-password "$(rand 8)"
secret demo-pm-password "$(rand 8)"
secret demo-reviewer-password "$(rand 8)"
if [ -n "$SME_SUPPLY" ]; then
  secret demo-finance-password "$(rand 8)"
  secret demo-partner-password "$(rand 8)"
fi
read_secret() { gcloud secrets versions access latest --secret="$1"; }

say "Cloud SQL for PostgreSQL 16 (about 10 minutes the first time)"
INSTANCE=praxis-demo
# Reached only through the Cloud SQL connector (IAM-authorised); no authorised networks are added.
exists gcloud sql instances describe "$INSTANCE" || gcloud sql instances create "$INSTANCE" --database-version=POSTGRES_16 \
  --edition=ENTERPRISE --tier=db-g1-small --region="$REGION" --storage-type=SSD --storage-size=10 --backup
exists gcloud sql databases describe praxis --instance="$INSTANCE" || gcloud sql databases create praxis --instance="$INSTANCE"
sql_user() { # name password-secret
  [ -n "$(gcloud sql users list --instance="$INSTANCE" --filter="name=$1" --format='value(name)')" ] || \
    gcloud sql users create "$1" --instance="$INSTANCE" --password="$(read_secret "$2")"
}
sql_user praxis_migrator db-password-migrator
sql_user praxis_app db-password-app
CONN=$(gcloud sql instances describe "$INSTANCE" --format='value(connectionName)')
secret database-url-migrator "postgresql://praxis_migrator:$(read_secret db-password-migrator)@localhost/praxis?host=/cloudsql/$CONN"
secret database-url-app "postgresql://praxis_app:$(read_secret db-password-app)@localhost/praxis?host=/cloudsql/$CONN"

say "Memorystore for Redis (about 5 minutes the first time)"
exists gcloud redis instances describe praxis-demo --region="$REGION" || gcloud redis instances create praxis-demo --region="$REGION" \
  --size=1 --tier=basic --redis-version=redis_7_2 --network=default --redis-config=maxmemory-policy=noeviction
REDIS_HOST=$(gcloud redis instances describe praxis-demo --region="$REGION" --format='value(host)')
secret redis-url "redis://$REDIS_HOST:6379"

else
  say "Redeploy only (project $PROJECT_ID)"
  gcloud config set project "$PROJECT_ID" >/dev/null
  PNUM=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
  SA=praxis-demo-run@$PROJECT_ID.iam.gserviceaccount.com
  BUCKET=$PROJECT_ID-demo-evidence
  INSTANCE=praxis-demo
  CONN=$(gcloud sql instances describe "$INSTANCE" --format='value(connectionName)')
  read_secret() { gcloud secrets versions access latest --secret="$1"; }
fi

say "Images (Cloud Build)"
exists gcloud artifacts repositories describe praxis --location="$REGION" || gcloud artifacts repositories create praxis --repository-format=docker --location="$REGION"
REPO=$REGION-docker.pkg.dev/$PROJECT_ID/praxis
API_URL=https://praxis-api-$PNUM.$REGION.run.app
WEB_URL=https://praxis-web-$PNUM.$REGION.run.app
CAND_URL=https://praxis-candidate-$PNUM.$REGION.run.app
gcloud builds submit "$ROOT" --config="$ROOT/infra/demo/cloudbuild.yaml" --region="$REGION" \
  --substitutions="_REPO=$REPO,_TAG=$TAG,_API_URL=$API_URL"

ENVFILE=$(mktemp)
cat > "$ENVFILE" <<YAML
NODE_ENV: production
APP_ENV: demo
COOKIE_SECURE: "true"
API_PORT: "8080"
CANDIDATE_APP_URL: $CAND_URL
CORS_ORIGINS: $WEB_URL,$CAND_URL
EVIDENCE_BUCKET: $BUCKET
GCS_PROJECT_ID: $PROJECT_ID
API_URL: $API_URL
WORKER_HEALTH_PORT: "8080"
PRAXIS_BUILD: "$BUILD"
PRAXIS_COMMIT: "$COMMIT"
YAML
if [ -n "$SME_SUPPLY" ]; then echo 'SME_SUPPLY_ENABLED: "true"' >> "$ENVFILE"; fi
if [ -n "$VERTEX" ]; then
  printf 'VERTEX_PROJECT_ID: %s\nVERTEX_LOCATION: "%s"\nEMBEDDING_LOCATION: "%s"\n' "$PROJECT_ID" "${VERTEX_LOCATION:-global}" "$REGION" >> "$ENVFILE"
  # Authoring v2.1 chatbot on Vertex (docs/ops/QA-ENV-SETUP.md). Owner's model is Claude Sonnet 5.5, but Claude quota
  # on Vertex was denied (10 Nov), so QA runs Gemini until it is granted; then set AUTHORING_MODEL=claude-sonnet-5-5.
  # The API refuses chatbot calls above the daily cap per client (429 MODEL_DAILY_CAP). Older builds ignore both.
  printf 'AUTHORING_MODEL: "%s"\nAUTHORING_DAILY_CALL_CAP: "%s"\n' "${AUTHORING_MODEL:-gemini:gemini-3.8-flash}" "${AUTHORING_DAILY_CALL_CAP:-300}" >> "$ENVFILE"
fi
# Live policy extraction (owner decision 10 Nov: live in QA; one-time setup: infra/demo/setup-policy-extraction.sh).
# Settings are added only when the Layout Parser processor exists in the project. The live switch is added only when
# this build's API accepts it outside staging: older builds refuse to start with POLICY_EXTRACTION_LIVE in a demo env.
# Off with PRAXIS_POLICY_LIVE=0. The LlamaExtract key is wired only once the owner has added a version to its secret.
LLAMA_SECRET=
if [ -n "$VERTEX" ] && [ "${PRAXIS_POLICY_LIVE:-1}" != "0" ]; then
  POLICY_PROCESSOR=$(curl -fsS -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    "https://us-documentai.googleapis.com/v1/projects/$PROJECT_ID/locations/us/processors" 2>/dev/null |
    python3 -c 'import json,sys; [print(p["name"]) for p in json.load(sys.stdin).get("processors",[]) if p.get("displayName")=="praxis-policy-layout"]' 2>/dev/null | head -1 || true)
  if [ -n "$POLICY_PROCESSOR" ]; then
    printf 'DOCUMENTAI_PROCESSOR: "%s"\nDOCUMENTAI_LOCATION: "us"\nPOLICY_GEMINI_MODEL: "%s"\nPOLICY_GEMINI_LOCATION: "%s"\nPOLICY_BUDGET_LLAMA_USD: "%s"\nPOLICY_BUDGET_GOOGLE_USD: "%s"\n' \
      "$POLICY_PROCESSOR" "${POLICY_GEMINI_MODEL:-gemini-3.8-flash}" "${POLICY_GEMINI_LOCATION:-global}" \
      "${POLICY_BUDGET_LLAMA_USD:-5}" "${POLICY_BUDGET_GOOGLE_USD:-5}" >> "$ENVFILE"
    if [ -n "${LLAMAEXTRACT_PROJECT_ID:-}" ]; then printf 'LLAMAEXTRACT_PROJECT_ID: "%s"\n' "$LLAMAEXTRACT_PROJECT_ID" >> "$ENVFILE"; fi
    if grep -q "POLICY_EXTRACTION_LIVE is only allowed in staging'" "$ROOT/apps/api/src/config.ts"; then
      echo "Policy extraction stays off: this build allows it live in staging only."
    else
      echo 'POLICY_EXTRACTION_LIVE: "true"' >> "$ENVFILE"
      if [ -n "$(gcloud secrets versions list llamaextract-api-key --filter=state=ENABLED --limit=1 --format='value(name)' 2>/dev/null)" ]; then
        LLAMA_SECRET=,LLAMAEXTRACT_API_KEY=llamaextract-api-key:latest
      fi
    fi
  fi
fi
# gcloud accepts one env-vars file and no extra variables, so the runtime role name lives in the shared file.
echo 'APP_DB_ROLE: praxis_app' >> "$ENVFILE"
COMMON=(--region="$REGION" --service-account="$SA" --set-cloudsql-instances="$CONN" --env-vars-file="$ENVFILE"
  --network=default --subnet=default --vpc-egress=private-ranges-only)
SECRETS=DATABASE_URL=database-url-app:latest,REDIS_URL=redis-url:latest,MOCK_SECRET=mock-secret:latest$LLAMA_SECRET

say "Database migrations (Cloud Run job, migration role)"
gcloud run jobs deploy praxis-migrate --image="$REPO/api:$TAG" "${COMMON[@]}" --max-retries=0 --task-timeout=1800s \
  --args=src/jobs/run.ts,migrate \
  --set-secrets=DATABASE_URL=database-url-migrator:latest,REDIS_URL=redis-url:latest,MOCK_SECRET=mock-secret:latest
gcloud run jobs execute praxis-migrate --region="$REGION" --wait

say "Services"
gcloud run deploy praxis-api --image="$REPO/api:$TAG" "${COMMON[@]}" --set-secrets="$SECRETS" \
  --no-invoker-iam-check --port=8080 --min-instances=0 --max-instances=3 --timeout=60
gcloud run deploy praxis-worker --image="$REPO/api:$TAG" "${COMMON[@]}" --set-secrets="$SECRETS" --args=src/worker.ts \
  --no-allow-unauthenticated --ingress=internal --port=8080 --no-cpu-throttling --min-instances=1 --max-instances=1
for app in web candidate; do
  gcloud run deploy "praxis-$app" --image="$REPO/$app:$TAG" --region="$REGION" --service-account="$SA" \
    --set-env-vars="^|^API_BASE_URL=$API_URL|CANDIDATE_APP_URL=$CAND_URL|PRAXIS_DEMO=1|PRAXIS_BUILD=$BUILD|PRAXIS_ENV_LABEL=$ENV_LABEL|SME_SUPPLY_ENABLED=${SME_SUPPLY:+true}" \
    --no-invoker-iam-check --port=8080 --min-instances=0 --max-instances=3
done

if [ -n "$VERTEX" ] && [ -f "$ROOT/apps/api/scripts/vertex-smoke.ts" ]; then
say "Vertex smoke job (deployed only; it makes two small billed calls, so it runs only when the owner says so)"
# Run it: gcloud run jobs execute praxis-vertex-smoke --region <region> --wait   (exit 0 live, 2 mock, 1 a call failed)
gcloud run jobs deploy praxis-vertex-smoke --image="$REPO/api:$TAG" "${COMMON[@]}" --max-retries=0 --task-timeout=300s \
  --args=scripts/vertex-smoke.ts --set-secrets="$SECRETS"
fi

if [ "${SKIP_DEMO_SETUP:-0}" != "1" ]; then
say "Demo data (users and a published KYC project)"
gcloud run jobs deploy praxis-demo-setup --image="$REPO/api:$TAG" "${COMMON[@]}" --max-retries=0 \
  --args=src/jobs/run.ts,demo-setup \
  --set-secrets="$SECRETS,DEMO_ADMIN_PASSWORD=demo-admin-password:latest,DEMO_PM_PASSWORD=demo-pm-password:latest,DEMO_REVIEWER_PASSWORD=demo-reviewer-password:latest${SME_SUPPLY:+,DEMO_FINANCE_PASSWORD=demo-finance-password:latest,DEMO_PARTNER_PASSWORD=demo-partner-password:latest}"
gcloud run jobs execute praxis-demo-setup --region="$REGION" --wait
fi
rm -f "$ENVFILE"

say "Ready"
if [ -n "${DEPLOY_ONLY:-}" ]; then
  printf 'Build %s deployed.\nConsole: %s\nCandidate app: %s\n' "$BUILD" "$WEB_URL" "$CAND_URL"
  exit 0
fi
cat <<OUT
Console (Admin, PM, Reviewer): $WEB_URL
Candidate app:                 $CAND_URL
API docs:                      $API_URL/docs

Admin     admin@praxis.demo     $(read_secret demo-admin-password)
PM        pm@praxis.demo        $(read_secret demo-pm-password)
Reviewer  reviewer@praxis.demo  $(read_secret demo-reviewer-password)
$(if [ -n "$SME_SUPPLY" ]; then printf 'Finance   finance@praxis.demo   %s\nPartner   partner@praxis.demo   %s   (partner portal: %s/partner/login)\n' "$(read_secret demo-finance-password)" "$(read_secret demo-partner-password)" "$WEB_URL"; fi)
Candidates: use the demo sign-in with any email.

Remove everything: gcloud projects delete $PROJECT_ID
OUT
