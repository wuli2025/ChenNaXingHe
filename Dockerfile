# ═══════════════════════════════════════════════════════════════
# Polaris · Docker 版（浏览器访问的容器服务，架构见 DOCKER.md）
# 三阶段：前端(Node) → 后端(Rust, server feature) → 运行时(slim + claude CLI)
# 需要 BuildKit（docker compose 默认启用）：依赖用 cache mount 缓存，
# 源码改动后重建通常 1–3 分钟。
# ═══════════════════════════════════════════════════════════════

# ── 阶段 1：前端构建 ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
RUN npm run build

# ── 阶段 2：后端构建（无 Tauri，纯 axum server）──────────────────
FROM rust:1.85-bookworm AS backend
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /app/src-tauri
COPY src-tauri ./
# 主 Cargo.toml 的 [[bin]] polaris-server 因桌面 bundler 问题保持注释
# （见 Cargo.toml 内 v1.0.1 说明），仅在镜像内追加后编译。
RUN printf '\n[[bin]]\nname = "polaris-server"\npath = "src/bin/polaris-server.rs"\n' >> Cargo.toml
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/src-tauri/target \
    cargo build --release --locked --bin polaris-server \
      --no-default-features --features server \
 && cp target/release/polaris-server /usr/local/bin/polaris-server

# ── 阶段 3：运行时 ───────────────────────────────────────────────
# node 基底：claude CLI 需要 Node ≥18；顺带自带 npm 便于容器内升级 CLI。
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code \
 && npm cache clean --force
# 全功能镜像（视频/网页截图）按 DOCKER.md 第九节追加 ffmpeg / playwright。

COPY --from=backend /usr/local/bin/polaris-server /usr/local/bin/polaris-server
COPY --from=frontend /app/dist /srv/web
COPY src-tauri/resources /app/resources

ENV POLARIS_WEB_DIR=/srv/web \
    POLARIS_RESOURCE_DIR=/app/resources \
    POLARIS_PORT=8080 \
    POLARIS_CHAT_TIMEOUT_SECS=180 \
    HOME=/root

# 数据全部落卷（见 docker-compose.yml）：/root/Polaris /root/.claude /root/.config
WORKDIR /root
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1
CMD ["/usr/local/bin/polaris-server"]
