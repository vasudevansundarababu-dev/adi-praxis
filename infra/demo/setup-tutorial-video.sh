#!/usr/bin/env bash
# One-time setup for D2 tutorial videos (docs/plan/PLAN-D2-TUTORIAL-VIDEO.md) in a demo-style environment
# (QA = adi-praxis-test-0928), which is deployed by infra/demo/deploy-demo.sh rather than Terraform. Mirrors the
# Terraform "tutorials" bucket (infra/terraform/modules/storage) and the Text-to-Speech API (modules/platform):
#   - enables the Vertex AI API (Gemini script, Veo clips) and the Cloud Text-to-Speech API (narration);
#   - creates the private bucket <project>-demo-tutorials with CORS for the console and candidate app, so the captions
#     track loads from the signed address;
#   - lets the runtime service account write that bucket and sign URLs with its own key (IAM signBlob).
# Re-running is safe. It never spends on Veo: generation only runs when an Admin presses "Generate tutorial".
# deploy-demo.sh turns tutorials on only when this bucket exists.
#
#   infra/demo/setup-tutorial-video.sh <project-id> [region]
set -euo pipefail

PROJECT_ID=${1:?project id, e.g. adi-praxis-test-0928}
REGION=${2:-us-central1}
SA=praxis-demo-run@$PROJECT_ID.iam.gserviceaccount.com
BUCKET=$PROJECT_ID-demo-tutorials
PNUM=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

say "APIs (Vertex AI, Text-to-Speech)"
gcloud services enable aiplatform.googleapis.com texttospeech.googleapis.com --project="$PROJECT_ID"

say "Runtime service account may call Vertex AI and sign URLs"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role=roles/aiplatform.user \
  --condition=None >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$SA" --project="$PROJECT_ID" --member="serviceAccount:$SA" \
  --role=roles/iam.serviceAccountTokenCreator >/dev/null

say "Tutorials bucket ($BUCKET)"
exists gcloud storage buckets describe "gs://$BUCKET" --project="$PROJECT_ID" ||
  gcloud storage buckets create "gs://$BUCKET" --project="$PROJECT_ID" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" \
  --role=roles/storage.objectAdmin >/dev/null
CORS=$(mktemp)
cat > "$CORS" <<JSON
[{"origin": ["https://praxis-web-$PNUM.$REGION.run.app", "https://praxis-candidate-$PNUM.$REGION.run.app"],
  "method": ["GET", "HEAD"], "responseHeader": ["Content-Type", "Range"], "maxAgeSeconds": 3600}]
JSON
gcloud storage buckets update "gs://$BUCKET" --cors-file="$CORS" >/dev/null
rm -f "$CORS"

echo
echo "Done. Next deploy-demo.sh run (PRAXIS_VERTEX=1, TUTORIAL_VIDEO=1) sets TUTORIAL_BUCKET=$BUCKET."
