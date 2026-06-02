FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable pnpm

# Workspace setup — copy the workspace manifest + only the deps needed to
# install our starter.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/starter-minio-docker/package.json apps/starter-minio-docker/
COPY packages/laikacms/package.json packages/laikacms/
COPY packages/decap/package.json packages/decap/

# Production install — uses the lockfile, no scripts.
RUN pnpm install --filter @laikacms/starter-minio-docker... --frozen-lockfile --ignore-scripts

# Build the laikacms package so subpath exports point at compiled dist.
COPY packages/laikacms packages/laikacms/
RUN pnpm --filter laikacms build

COPY packages/decap packages/decap/
RUN pnpm --filter @laikacms/decap-integrations build

COPY apps/starter-minio-docker apps/starter-minio-docker/

WORKDIR /app/apps/starter-minio-docker
EXPOSE 3000
CMD ["pnpm", "start"]
