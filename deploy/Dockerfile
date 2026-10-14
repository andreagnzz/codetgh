# Build context: repository root. docker build -f deploy/Dockerfile .
FROM node:24.21.0-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/hub/package.json apps/hub/
COPY packages/shared/package.json packages/shared/
COPY packages/guard/package.json packages/guard/
COPY packages/cli/package.json packages/cli/
COPY packages/sdk/package.json packages/sdk/
COPY packages/channel-bridge/package.json packages/channel-bridge/
COPY e2e/package.json e2e/
RUN COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @codetgh/hub --filter @codetgh/cli --filter @codetgh/channel-bridge build \
 && node scripts/bundles.mjs \
 && mkdir -p /runtime/node_modules/@electric-sql \
 && cp -rL apps/hub/node_modules/@electric-sql/pglite /runtime/node_modules/@electric-sql/ \
 && cp -rL apps/hub/node_modules/htmx.org apps/hub/node_modules/htmx-ext-sse /runtime/node_modules/

# The bundle carries the code; node_modules only holds PGlite (wasm) and the htmx assets; dist/ also holds the plugin and CLI members install.
FROM node:24.21.0-bookworm-slim
ENV NODE_ENV=production PORT=8787 CODETGH_DATA_DIR=/data
WORKDIR /app
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /repo/apps/hub/dist/server ./dist/server
COPY --from=build /repo/apps/hub/dist/plugin.zip /repo/apps/hub/dist/codetgh-cli.tgz ./dist/
COPY --from=build /repo/apps/hub/drizzle ./drizzle
COPY --from=build /repo/apps/hub/public ./public
COPY --from=build /repo/assets/brand ./brand
ENV CODETGH_BRAND_DIR=/app/brand
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server/main.js"]
