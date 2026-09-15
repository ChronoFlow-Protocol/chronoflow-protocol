# ChronoFlow indexer API — container image.
#
# Build from the repository root so the pnpm workspace is available:
#   docker build -f packages/backend/Dockerfile -t chronoflow-api .
#
# The image runs `prisma migrate deploy`-compatible `db push` only when asked
# (see fly.toml's release_command); the server itself never mutates the schema.

FROM node:22.13.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
# Prisma's engines need OpenSSL at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---- dependencies -----------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN pnpm install --frozen-lockfile --filter @chronoflow/backend... --prod=false

# ---- build ------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY packages/backend packages/backend
RUN pnpm --filter @chronoflow/backend run db:generate \
  && pnpm --filter @chronoflow/backend run build \
  && pnpm prune --prod

# ---- runtime ----------------------------------------------------------------
FROM base AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages/backend ./packages/backend

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/backend/dist/index.js"]
