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
# The seed imports pg and zod; zod is bundled into the server, so standalone leaves it out.
RUN mkdir -p /seed-modules && cp -RL node_modules/zod /seed-modules/zod

FROM base AS runner
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
# Only the files the server traces as used, plus static assets (Next leaves those out of standalone).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /seed-modules/zod ./node_modules/zod
COPY public ./public
# The demo seed runs at start-up from these sources (Node strips the TypeScript types).
COPY lib ./lib
COPY shared ./shared
COPY scripts ./scripts
COPY docker/app-entrypoint.sh ./docker/app-entrypoint.sh
USER node
EXPOSE 3000
CMD ["sh", "docker/app-entrypoint.sh"]
