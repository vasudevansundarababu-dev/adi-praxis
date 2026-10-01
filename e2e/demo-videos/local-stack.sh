#!/usr/bin/env bash
# A local copy of the demo environment for rehearsing the demo videos: demo mode (simulated Google sign-in, identity,
# payouts, AI), SME supply on, its own database (praxis_video) and ports (API 4500, worker 4501, console 3500,
# candidate 3501), so a running `pnpm dev` is not disturbed. Needs `pnpm services:up` (Postgres, Redis, GCS, Mailpit).
#
#   e2e/demo-videos/local-stack.sh          # reset the database, run demo-setup, start all four servers
#   e2e/demo-videos/local-stack.sh stop     # stop them
#
# Local passwords are fixed below; they only exist in this throwaway database.
set -euo pipefail
cd "$(dirname "$0")/../.."
LOGS=out/demo-videos/local-logs
mkdir -p "$LOGS"
PIDS=out/demo-videos/local.pids

stop() { [ -f "$PIDS" ] && while read -r p; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done < "$PIDS"; rm -f "$PIDS"; }
if [ "${1:-}" = stop ]; then stop; echo "stopped"; exit 0; fi
stop

export NODE_ENV=development APP_ENV=demo PRAXIS_DEMO=1 PRAXIS_ENV_LABEL="Demo environment" PRAXIS_BUILD=local-video
export DATABASE_URL=postgresql://praxis:praxis@localhost:5442/praxis_video
export REDIS_URL=redis://localhost:6389/5
export SME_SUPPLY_ENABLED=true M10_ENCRYPTION_KEY=$(printf 'local-video-key-0123456789abcdef' | base64)
export CANDIDATE_APP_URL=http://localhost:3501 CORS_ORIGINS=http://localhost:3500,http://localhost:3501
export GCS_EMULATOR_HOST=http://localhost:4443 GCS_PROJECT_ID=praxis-local EVIDENCE_BUCKET=praxis-evidence
export MOCK_SECRET=local-video-mock-secret-0123456789abcdef
export SMTP_HOST=localhost SMTP_PORT=1035 LOGIN_RATE_LIMIT_PER_MINUTE=1000 NEXT_TELEMETRY_DISABLED=1
export TASKFLOW_PATH=$PWD/docs/Taskflow.xlsx DATASET_VERIFY_CRON=off
export DEMO_ADMIN_PASSWORD=video-admin-password DEMO_PM_PASSWORD=video-pm-password DEMO_REVIEWER_PASSWORD=video-reviewer-password
export DEMO_FINANCE_PASSWORD=video-finance-password DEMO_PARTNER_PASSWORD=video-partner-password

docker exec adi-praxis-postgres-1 psql -U praxis -d postgres -qc 'DROP DATABASE IF EXISTS praxis_video WITH (FORCE)' -c 'CREATE DATABASE praxis_video'
docker exec adi-praxis-postgres-1 psql -U praxis -d praxis_video -qc 'CREATE EXTENSION IF NOT EXISTS vector' >/dev/null
(cd apps/api && npx prisma migrate deploy >/dev/null)

: > "$PIDS"
start() { local name=$1; shift; ( "$@" > "$LOGS/$name.log" 2>&1 & echo $! >> "$PIDS" ); }
wait_for() { for _ in $(seq 1 180); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done; echo "timed out waiting for $1"; exit 1; }

API_PORT=4500 start api pnpm --filter @praxis/api exec tsx src/server.ts
WORKER_HEALTH_PORT=4501 start worker pnpm --filter @praxis/api exec tsx src/worker.ts
API_BASE_URL=http://localhost:4500 NEXT_DIST_DIR=.next-video start web pnpm --filter @praxis/web exec next dev -p 3500
API_BASE_URL=http://localhost:4500 NEXT_DIST_DIR=.next-video start candidate pnpm --filter @praxis/candidate exec next dev -p 3501
wait_for http://localhost:4500/healthz
API_URL=http://localhost:4500 pnpm --filter @praxis/api exec tsx src/jobs/run.ts demo-setup > "$LOGS/demo-setup.log" 2>&1
wait_for http://localhost:3500/login
wait_for http://localhost:3501/sign-in
# next dev rewrites these for its custom dist dir; keep the checked-in versions.
git checkout -- apps/web/tsconfig.json apps/web/next-env.d.ts apps/candidate/tsconfig.json apps/candidate/next-env.d.ts
echo "local demo stack ready: console http://localhost:3500  candidate http://localhost:3501  (logs in $LOGS)"
