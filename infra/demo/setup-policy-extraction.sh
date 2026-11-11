#!/usr/bin/env bash
# One-time setup for live policy extraction in a demo-style environment (QA = adi-praxis-test-0928), which is deployed
# by infra/demo/deploy-demo.sh rather than Terraform. Mirrors infra/terraform/modules/policy-extraction:
#   - enables the Document AI API and creates the Layout Parser processor "praxis-policy-layout" (location us);
#   - lets the runtime service account call Document AI (roles/documentai.apiUser);
#   - creates the empty Secret Manager slot "llamaextract-api-key" (no value: the owner adds the key themselves).
# Re-running is safe. It never reads or prints a secret value. Prints the processor id for deploy-demo.sh.
#
#   infra/demo/setup-policy-extraction.sh <project-id>
set -euo pipefail

PROJECT_ID=${1:?project id, e.g. adi-praxis-test-0928}
LOCATION=us
NAME=praxis-policy-layout
SA=praxis-demo-run@$PROJECT_ID.iam.gserviceaccount.com
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

say "Document AI API"
gcloud services enable documentai.googleapis.com --project="$PROJECT_ID"

say "Layout Parser processor ($NAME, location $LOCATION)"
TOKEN=$(gcloud auth print-access-token)
API=https://$LOCATION-documentai.googleapis.com/v1/projects/$PROJECT_ID/locations/$LOCATION/processors
find_processor() {
  curl -fsS -H "Authorization: Bearer $TOKEN" "$API" |
    python3 -c 'import json,sys; [print(p["name"]) for p in json.load(sys.stdin).get("processors",[]) if p.get("displayName")==sys.argv[1]]' "$NAME" | head -1
}
PROCESSOR=$(find_processor)
if [ -z "$PROCESSOR" ]; then
  curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$API" \
    -d "{\"type\":\"LAYOUT_PARSER_PROCESSOR\",\"displayName\":\"$NAME\"}" >/dev/null
  PROCESSOR=$(find_processor)
fi
[ -n "$PROCESSOR" ] || { echo "Processor not found after create" >&2; exit 1; }

say "Runtime service account may call Document AI"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role=roles/documentai.apiUser \
  --condition=None >/dev/null

say "LlamaExtract key slot (empty)"
exists gcloud secrets describe llamaextract-api-key --project="$PROJECT_ID" ||
  gcloud secrets create llamaextract-api-key --project="$PROJECT_ID" --replication-policy=automatic
# The runtime account already has roles/secretmanager.secretAccessor on the project (deploy-demo.sh).

say "Done"
echo "DOCUMENTAI_PROCESSOR=$PROCESSOR"
echo "DOCUMENTAI_LOCATION=$LOCATION"
