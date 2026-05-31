FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable pnpm

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/starter-render/package.json apps/starter-render/
COPY packages/laikacms/package.json packages/laikacms/
COPY packages/decap/package.json packages/decap/

RUN pnpm install --filter @laikacms/starter-render... --frozen-lockfile --ignore-scripts

COPY packages/laikacms packages/laikacms/
RUN pnpm --filter laikacms build

COPY packages/decap packages/decap/
RUN pnpm --filter @laikacms/decap-integrations build

COPY apps/starter-render apps/starter-render/

WORKDIR /app/apps/starter-render
EXPOSE 10000
CMD ["pnpm", "start"]
