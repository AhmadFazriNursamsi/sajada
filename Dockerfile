# Sajada web + /v1 API (Next.js). Built and run by services/compose.yaml (service "app").
FROM node:24-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
# Only the files the server traces as used, plus static assets (Next leaves those out of standalone).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY public ./public
# The first-admin script runs at start-up from these sources (Node strips the TypeScript types;
# pg is in the standalone node_modules).
COPY lib/server/db.ts lib/server/password.ts ./lib/server/
COPY scripts/admin-account.ts ./scripts/
COPY docker/app-entrypoint.sh ./docker/app-entrypoint.sh
# next/image writes optimized images here at runtime; everything else stays root-owned.
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
CMD ["sh", "docker/app-entrypoint.sh"]
