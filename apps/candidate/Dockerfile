# praxis-candidate (Next.js standalone). Build from the repository root: docker build -f apps/candidate/Dockerfile .
# No environment-specific values are baked in: API_BASE_URL and the other settings are read at runtime.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/candidate/package.json apps/candidate/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @praxis/candidate...
COPY packages/shared packages/shared
COPY apps/candidate apps/candidate
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @praxis/candidate build

FROM node:22-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/candidate/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/candidate/.next/static ./apps/candidate/.next/static
USER node
EXPOSE 8080
CMD ["node", "apps/candidate/server.js"]
