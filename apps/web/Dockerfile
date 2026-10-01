# praxis-web (Next.js standalone). Build from the repository root: docker build -f apps/web/Dockerfile .
# Settings are read at runtime, except the /api/v1 proxy target (build argument API_BASE_URL, demo only).
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @praxis/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
# Where /api/v1 is proxied (Next rewrites are fixed at build time). Behind the load balancer (M8) /api is routed
# before it reaches Next, so the default is only used by the demo environment.
ARG API_BASE_URL=http://localhost:4000
ENV NEXT_TELEMETRY_DISABLED=1 API_BASE_URL=$API_BASE_URL
RUN pnpm --filter @praxis/web build

FROM node:22-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
# Tutorial videos and guides, served after a sign-in check by app/tutorials/files (not public).
COPY --from=build --chown=node:node /repo/apps/web/tutorials ./apps/web/tutorials
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
