#!/usr/bin/env bash
# Lets GitHub Actions in one repository reach the TEST environment's Google Cloud project without keys
# (Workload Identity Federation), with two narrow service accounts:
#   praxis-gh-deployer  nightly build: Cloud Build, Artifact Registry, Cloud Run deploy and jobs, read Cloud SQL
#   praxis-gh-agent     nightly defect agent: Claude on Vertex AI only
#
#   infra/test/setup-github-access.sh <project-id> <github-owner/repo>
#
# Prints the four repository variables to set in GitHub (Settings -> Secrets and variables -> Actions -> Variables).
# Re-running is safe.
set -euo pipefail
PROJECT_ID=${1:?project id of the test environment}
REPO=${2:?github owner/repo, e.g. vasudevansundarababu-dev/adi-praxis}
POOL=github
PROVIDER=github-oidc
exists() { "$@" >/dev/null 2>&1; }
PNUM=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com aiplatform.googleapis.com --project="$PROJECT_ID"

exists gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT_ID" ||
  gcloud iam workload-identity-pools create "$POOL" --location=global --project="$PROJECT_ID" --display-name="GitHub Actions"
exists gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT_ID" ||
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT_ID" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == '$REPO'"
PRINCIPAL="principalSet://iam.googleapis.com/projects/$PNUM/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO"

sa() { # name display roles...
  local name=$1 display=$2; shift 2
  local email="$name@$PROJECT_ID.iam.gserviceaccount.com"
  exists gcloud iam service-accounts describe "$email" --project="$PROJECT_ID" || gcloud iam service-accounts create "$name" --project="$PROJECT_ID" --display-name="$display"
  for role in "$@"; do gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$email" --role="$role" --condition=None >/dev/null; done
  gcloud iam service-accounts add-iam-policy-binding "$email" --project="$PROJECT_ID" --role=roles/iam.workloadIdentityUser --member="$PRINCIPAL" >/dev/null
  echo "$email"
}
DEPLOYER=$(sa praxis-gh-deployer "GitHub nightly deploy" roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer \
  roles/storage.admin roles/cloudsql.viewer roles/serviceusage.serviceUsageConsumer roles/logging.viewer roles/secretmanager.viewer)
AGENT=$(sa praxis-gh-agent "GitHub nightly defect agent" roles/aiplatform.user)
# The deployer runs services as the runtime account and Cloud Build as the default compute account.
for target in "praxis-demo-run@$PROJECT_ID.iam.gserviceaccount.com" "$PNUM-compute@developer.gserviceaccount.com"; do
  gcloud iam service-accounts add-iam-policy-binding "$target" --project="$PROJECT_ID" --role=roles/iam.serviceAccountUser --member="serviceAccount:$DEPLOYER" >/dev/null
done

cat <<OUT

Set these repository variables in GitHub (Settings -> Secrets and variables -> Actions -> Variables):
  TEST_GCP_PROJECT    $PROJECT_ID
  TEST_WIF_PROVIDER   projects/$PNUM/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER
  TEST_DEPLOYER_SA    $DEPLOYER
  AGENT_SA            $AGENT
OUT
