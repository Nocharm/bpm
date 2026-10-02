# 서버(사내 71번)는 Docker Hub 차단 — 베이스 이미지는 amd64 tar로 반입(docker load)한다(docs/deploy/deploy.md §0).
# `# syntax=` 지시어 금지: 빌드마다 docker/dockerfile 프런트엔드 이미지를 레지스트리에서 찾아 프룬 뒤 빌드가 죽는다. 내장 파서로 충분.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 인증 모드는 백엔드가 런타임에 GET /api/auth/mode로 알려준다 — 빌드 타임 인라인 불필요(설계 §2).
RUN npm run build

# standalone 산출물만 담은 런타임 이미지 (next.config.ts output: "standalone")
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# node 이미지에 내장된 비루트 사용자
USER node

EXPOSE 3000
CMD ["node", "server.js"]
