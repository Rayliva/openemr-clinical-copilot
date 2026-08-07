# Clinical Co-Pilot sidecar agent — production image.
#
# Runs the agent via tsx (the @copilot/* workspace packages are source-only, so
# tsx executes the TypeScript directly, mirroring dev and avoiding a cross-package
# build step). Only the agent subtree is installed (`--filter @copilot/agent...`),
# which excludes root dev tooling like promptfoo/better-sqlite3 (native, build-heavy).
#
# Secrets are NEVER baked in: .env and .secrets are excluded via .dockerignore and
# provided at runtime (compose env + a read-only bind mount).
FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable

# Manifests first for layer caching, then sources.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps ./apps

# Install only the agent and its workspace dependencies (skips root devDeps).
RUN pnpm install --frozen-lockfile --filter "@copilot/agent..."

ENV PORT=3000 HOST=0.0.0.0
EXPOSE 3000

# tsx runs the TS entrypoint directly.
CMD ["pnpm", "--filter", "@copilot/agent", "exec", "tsx", "src/server.ts"]
