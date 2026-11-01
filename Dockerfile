# syntax=docker/dockerfile:1
# Skimjob: one image with the game server and the built web app (docs/deploy.md).
#   docker build -t skimjob .
#   docker run --rm -p 8080:8080 -v skimjob-data:/data -e PUBLIC_ORIGIN=http://localhost:8080 skimjob

# ---- build: install, build the web app, bundle the server, prune to prod deps
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install -g pnpm@10.28.0
WORKDIR /repo
# Only the lockfile: this layer (all downloads) is cached until it changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile \
 && pnpm --filter @skimjob/web build \
 && pnpm --filter @skimjob/server build \
 && pnpm --filter @skimjob/server deploy --prod --legacy /out

# ---- runtime: Node 22 on Alpine, prod node_modules + two bundles, no sources or tools
FROM node:22-alpine AS runtime
# su-exec: the entrypoint fixes the volume's ownership as root, then drops to `node`.
RUN apk add --no-cache su-exec
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    WEB_DIR=/app/web \
    PGLITE_DIR=/data/pglite
WORKDIR /app/server
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/server/dist ./dist
COPY --from=build --chown=node:node /repo/apps/server/migrations ./migrations
COPY --from=build --chown=node:node /repo/apps/web/dist /app/web
COPY apps/server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
