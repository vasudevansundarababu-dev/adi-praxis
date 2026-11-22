#!/usr/bin/env bash
# Records what a Cloud Run project is running before a release changes it, and restores exactly that on failure.
#
#   cloud-run-state.sh record  <state-file>            serving revision of each service, image of each job
#   cloud-run-state.sh restore <state-file> <what>...  what: services | worker | jobs
#   cloud-run-state.sh digest  <service>               the image digest the service's serving revision runs
#   cloud-run-state.sh job-image <job>                 the image a job runs (empty if the job does not exist)
#
# Needs PROJECT and REGION in the environment, gcloud authenticated, and jq.
#
# Why record instead of "the second-newest revision": a failed build or migration creates no new revision, so the
# second-newest is the release BEFORE the one serving, and a rollback would silently drop production back a release.
# Jobs (migrate, verify-chains, harbor-verify) have no revisions at all, so their previous image must be remembered.
set -euo pipefail

: "${PROJECT:?PROJECT is required}" "${REGION:?REGION is required}"
SERVICES=(praxis-api praxis-web praxis-candidate)
WORKER=praxis-worker
JOBS=(praxis-migrate praxis-verify-chains praxis-harbor-verify)

gc() { gcloud "$@" --project "$PROJECT" --region "$REGION"; }

# The revision taking the most traffic (100% outside a canary). Empty when the service does not exist yet.
serving_revision() {
  local json
  json=$(gc run services describe "$1" --format=json 2>/dev/null) || return 0   # not created yet: nothing to restore
  jq -r '[.status.traffic[]? | select((.percent // 0) > 0)] | max_by(.percent) | .revisionName // empty' <<<"$json"
}

job_image() {
  local json
  json=$(gc run jobs describe "$1" --format=json 2>/dev/null) || return 0
  jq -r '.spec.template.spec.template.spec.containers[0].image // empty' <<<"$json"
}

record() {
  local file=$1
  : >"$file"
  for s in "${SERVICES[@]}" "$WORKER"; do
    r=$(serving_revision "$s")
    echo "service $s ${r:--}" >>"$file"
  done
  for j in "${JOBS[@]}"; do
    i=$(job_image "$j")
    echo "job $j ${i:--}" >>"$file"
  done
  cat "$file"
}

restore() {
  local file=$1
  shift
  local want=" $* " failed=0
  while read -r kind name value; do
    [ "$value" = "-" ] && { echo "skip $name: nothing was running before"; continue; }
    if [ "$kind" = service ]; then
      if [ "$name" = "$WORKER" ]; then [[ $want == *" worker "* ]] || continue; else [[ $want == *" services "* ]] || continue; fi
      echo "restore $name -> $value (100%)"
      gc run services update-traffic "$name" --to-revisions "$value=100" || failed=1
    elif [ "$kind" = job ]; then
      [[ $want == *" jobs "* ]] || continue
      echo "restore job $name -> $value"
      gc run jobs update "$name" --image "$value" || failed=1
    fi
  done <"$file"
  return $failed
}

# Immutable reference for promotion: repo@sha256:..., resolved from the serving revision (a tag can be re-pointed).
digest() {
  local rev
  rev=$(serving_revision "$1")
  [ -n "$rev" ] || { echo "no serving revision for $1" >&2; return 1; }
  d=$(gc run revisions describe "$rev" --format='value(status.imageDigest)')
  [[ $d == *@sha256:* ]] || { echo "revision $rev has no image digest ($d)" >&2; return 1; }
  echo "$d"
}

case "${1:-}" in
  record) record "${2:?state file}" ;;
  restore) f=${2:?state file}; shift 2; restore "$f" "$@" ;;
  digest) digest "${2:?service}" ;;
  job-image) job_image "${2:?job}" ;;
  *) echo "usage: $0 record <file> | restore <file> services|worker|jobs... | digest <service> | job-image <job>" >&2; exit 2 ;;
esac
