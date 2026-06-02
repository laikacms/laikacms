FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable pnpm

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/starter-fly-io/package.json apps/starter-fly-io/
COPY packages/laikacms/package.json packages/laikacms/
COPY packages/decap/package.json packages/decap/

RUN pnpm install --filter @laikacms/starter-fly-io... --frozen-lockfile --ignore-scripts

COPY packages/laikacms packages/laikacms/
RUN pnpm --filter laikacms build

COPY packages/decap packages/decap/
RUN pnpm --filter @laikacms/decap-integrations build

COPY apps/starter-fly-io apps/starter-fly-io/

WORKDIR /app/apps/starter-fly-io
EXPOSE 8080
CMD ["pnpm", "start"]
