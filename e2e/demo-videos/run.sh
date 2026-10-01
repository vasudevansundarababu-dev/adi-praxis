#!/usr/bin/env bash
# Records the demo videos against a deployed environment, then builds the MP4s (docs/user-guide/VIDEOS.md).
#
#   e2e/demo-videos/run.sh                       # the testers' environment (adi-praxis-test-0928)
#   e2e/demo-videos/run.sh adi-praxis-demo-0927  # the demo environment
#   e2e/demo-videos/run.sh local                 # the local stack from local-stack.sh
#
# Passwords are read from the project's Secret Manager at run time and never written to disk.
# Everything the videos create is named "[Demo video] …" so testers can tell it apart.
set -euo pipefail
cd "$(dirname "$0")/../.."
TARGET=${1:-adi-praxis-test-0928}
export PATH="$PWD/google-cloud-sdk/bin:$PATH"

if [ "$TARGET" != local ]; then
  NUM=$(gcloud projects describe "$TARGET" --format='value(projectNumber)')
  export VIDEO_WEB_URL="https://praxis-web-$NUM.us-central1.run.app"
  export VIDEO_CANDIDATE_URL="https://praxis-candidate-$NUM.us-central1.run.app"
  export VIDEO_API_URL="https://praxis-api-$NUM.us-central1.run.app"
  for r in admin pm reviewer finance partner; do
    R=$(echo "$r" | tr '[:lower:]' '[:upper:]')
    export "VIDEO_${R}_PASSWORD=$(gcloud secrets versions access latest --secret="demo-$r-password" --project="$TARGET")"
  done
fi

rm -rf out/demo-videos/raw out/demo-videos/state.json
VIDEO_FRESH=1 npx playwright test -c e2e/demo-videos "${@:2}"
node e2e/demo-videos/make-videos.mjs
