#!/usr/bin/env bash
# Tests cloud-run-state.sh against a fake gcloud (no cloud access):  bash infra/deploy/test/cloud-run-state.test.sh
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
script="$here/../cloud-run-state.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fails=0
ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }

# Fake gcloud: canned describe output; every mutating call is appended to $tmp/calls.
mkdir "$tmp/bin"
cat >"$tmp/bin/gcloud" <<'FAKE'
#!/usr/bin/env bash
args="$*"
case "$args" in
  "run services describe praxis-api "*)      echo '{"status":{"traffic":[{"revisionName":"api-old","percent":90},{"revisionName":"api-rc","percent":10}]}}' ;;
  "run services describe praxis-web "*)      echo '{"status":{"traffic":[{"revisionName":"web-1","percent":100},{"tag":"rc-x","revisionName":"web-2","percent":0}]}}' ;;
  "run services describe praxis-candidate "*) exit 1 ;;   # not created yet
  "run services describe praxis-worker "*)   echo '{"status":{"traffic":[{"revisionName":"worker-7","percent":100,"latestRevision":true}]}}' ;;
  "run jobs describe praxis-harbor-verify "*) echo '{"spec":{"template":{"spec":{"template":{"spec":{"containers":[{"image":"reg/harbor-verify:abc"}]}}}}}}' ;;
  "run jobs describe "*)                     echo '{"spec":{"template":{"spec":{"template":{"spec":{"containers":[{"image":"reg/api:abc"}]}}}}}}' ;;
  "run revisions describe web-1 "*)          echo 'reg/web@sha256:1111' ;;
  "run revisions describe api-old "*)        echo 'reg/api:v1' ;;
  *) echo "$args" >>"$CALLS" ;;
esac
FAKE
chmod +x "$tmp/bin/gcloud"
export PATH="$tmp/bin:$PATH" PROJECT=p REGION=r CALLS="$tmp/calls"
: >"$CALLS"

bash "$script" record "$tmp/state" >/dev/null
grep -qx 'service praxis-api api-old' "$tmp/state" && ok "record: the revision with the most traffic (canary split)" || bad "record: canary split"
grep -qx 'service praxis-web web-1' "$tmp/state" && ok "record: a 0% tagged rc revision is not the serving one" || bad "record: 0% tag"
grep -qx 'service praxis-candidate -' "$tmp/state" && ok "record: a missing service is recorded as nothing" || bad "record: missing service"
grep -qx 'job praxis-harbor-verify reg/harbor-verify:abc' "$tmp/state" && ok "record: job images" || bad "record: job images"

: >"$CALLS"
bash "$script" restore "$tmp/state" jobs >/dev/null
! grep -q 'update-traffic' "$CALLS" && grep -q 'run jobs update praxis-harbor-verify --image reg/harbor-verify:abc' "$CALLS" &&
  ok "restore jobs: job images only, traffic untouched (failed build/migration)" || bad "restore jobs"

: >"$CALLS"
bash "$script" restore "$tmp/state" services >/dev/null
grep -q 'update-traffic praxis-api --to-revisions api-old=100' "$CALLS" && ! grep -q 'praxis-worker' "$CALLS" && ! grep -q 'praxis-candidate' "$CALLS" &&
  ok "restore services: exactly the recorded revisions, worker and never-existing services left alone" || bad "restore services"

: >"$CALLS"
bash "$script" restore "$tmp/state" worker >/dev/null
grep -q 'update-traffic praxis-worker --to-revisions worker-7=100' "$CALLS" && ok "restore worker" || bad "restore worker"

[ "$(bash "$script" digest praxis-web)" = 'reg/web@sha256:1111' ] && ok "digest: immutable reference of the serving revision" || bad "digest"
if bash "$script" digest praxis-api >/dev/null 2>&1; then bad "digest: refuses a tag-only reference"; else ok "digest: refuses a tag-only reference"; fi

[ "$(bash "$script" job-image praxis-harbor-verify)" = 'reg/harbor-verify:abc' ] && ok "job-image" || bad "job-image"

exit $fails
