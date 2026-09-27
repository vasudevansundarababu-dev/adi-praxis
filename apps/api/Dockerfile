# praxis-api, praxis-worker and the Cloud Run jobs share this image; the command differs (see infra/terraform).
# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @praxis/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @praxis/api deploy --legacy --prod /out \
  && cd /out && npx prisma generate

FROM base AS runtime
ENV NODE_ENV=production API_PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
# Override for the worker ("src/worker.ts") and jobs ("src/jobs/run.ts", "migrate" | "verify-chains").
ENTRYPOINT ["node_modules/.bin/tsx"]
CMD ["src/server.ts"]
