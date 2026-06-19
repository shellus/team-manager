FROM node:22-bookworm-slim AS build

WORKDIR /app
# 国内镜像源 + 预装 pnpm，避免 corepack/registry 跨境
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry https://registry.npmmirror.com && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN corepack pnpm config set registry https://registry.npmmirror.com && corepack pnpm install --frozen-lockfile

COPY . .
RUN corepack pnpm build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV TEAMMGR_DATA_DIR=/app/data
ENV TEAMMGR_WEB_DIST_DIR=/app/apps/web/dist
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry https://registry.npmmirror.com && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN corepack pnpm config set registry https://registry.npmmirror.com && corepack pnpm install --frozen-lockfile --prod --filter @team-manager/server...

COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

RUN mkdir -p /app/data

CMD ["node", "apps/server/dist/index.js"]
