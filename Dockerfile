# BusKothay API container.
#
# Build from the REPOSITORY ROOT, not from apps/api: the workspace lockfile, the
# shared packages and the route fixtures all live above that directory, and an
# image built without them cannot resolve @buskothay/shared at runtime.
#
#   docker build -t buskothay-api:local .
#
# Node 24 LTS, matching .nvmrc and CI. See docs/DECISIONS.md §1.

# ---------------------------------------------------------------------------
# Stage 1 — install every workspace dependency from the committed lockfile.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/geometry/package.json packages/geometry/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/simulator/package.json apps/simulator/

# `npm ci` is reproducible and fails loudly if the lockfile is out of date.
RUN npm ci --workspaces --include-workspace-root

# ---------------------------------------------------------------------------
# Stage 2 — compile the shared packages, then the API that depends on them.
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/

RUN npm run build -w @buskothay/geometry \
 && npm run build -w @buskothay/shared \
 && npm run build -w @buskothay/api

# ---------------------------------------------------------------------------
# Stage 3 — production dependencies only.
# ---------------------------------------------------------------------------
FROM deps AS prod-deps
WORKDIR /app
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ---------------------------------------------------------------------------
# Stage 4 — the runtime image.
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    ROUTE_DATA_DIR=/app/data/routes

# Workspace symlinks must survive the copy, or the container will fail to resolve
# @buskothay/shared at startup — a failure that source checkouts never show.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json

COPY --from=build /app/packages/geometry/package.json ./packages/geometry/package.json
COPY --from=build /app/packages/geometry/dist ./packages/geometry/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist

# The route fixtures are part of the application, not configuration to mount.
COPY data/routes/ ./data/routes/

# Run as the image's unprivileged user.
USER node

EXPOSE 8080

# App Runner's configured health path. Liveness is local and does not call AWS.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
