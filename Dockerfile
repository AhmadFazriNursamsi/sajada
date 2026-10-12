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
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts tsconfig.json ./
COPY public ./public
# The demo seed runs at start-up from these sources (Node strips the TypeScript types).
COPY lib ./lib
COPY shared ./shared
COPY scripts ./scripts
COPY docker/app-entrypoint.sh ./docker/app-entrypoint.sh
USER node
EXPOSE 3000
CMD ["sh", "docker/app-entrypoint.sh"]
