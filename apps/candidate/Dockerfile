# praxis-candidate (Next.js standalone). Build from the repository root: docker build -f apps/candidate/Dockerfile .
# Settings are read at runtime, except the /api/v1 proxy target (build argument API_BASE_URL, demo only).
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/candidate/package.json apps/candidate/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @praxis/candidate...
COPY packages/shared packages/shared
COPY apps/candidate apps/candidate
# Where /api/v1 is proxied (Next rewrites are fixed at build time). Behind the load balancer (M8) /api is routed
# before it reaches Next, so the default is only used by the demo environment.
ARG API_BASE_URL=http://localhost:4000
ENV NEXT_TELEMETRY_DISABLED=1 API_BASE_URL=$API_BASE_URL
RUN pnpm --filter @praxis/candidate build

FROM node:22-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/candidate/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/candidate/.next/static ./apps/candidate/.next/static
USER node
EXPOSE 8080
CMD ["node", "apps/candidate/server.js"]
