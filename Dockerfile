# syntax=docker/dockerfile:1.7

# ---------- builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
# better-sqlite3 是原生模块：prebuild 拉不到时 node-gyp 回退源码编译，需要 Python 与 C++ 工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# 趁工具链还在，在这里裁掉 devDependencies；runner 只搬产物，不必再装一次编译器
RUN npm prune --omit=dev && npm cache clean --force

# ---------- runner ----------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=3456

# Chromium + 中日韩字体（Amazon 搜索页会渲染 CJK 商品名）
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-noto-cjk \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 原生模块与 runner 同为 node:20-bookworm-slim（同 glibc、同 ABI），直接搬运编译产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./
COPY public ./public

EXPOSE 3456
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3456)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
