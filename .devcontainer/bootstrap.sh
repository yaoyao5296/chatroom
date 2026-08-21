#!/usr/bin/env bash
# Codespace 每次启动时运行 —— 构建产物 + 上报公开 URL + 启动服务 + 拉起空闲守护
set -euo pipefail

cd /workspaces/chatroom 2>/dev/null || cd "$CODESPACE_VSCODE_FOLDER" 2>/dev/null || cd /workspace 2>/dev/null
ROOT="$PWD"

echo "[bootstrap] Codespace 启动于 $(date -u +%FT%TZ)"
echo "[bootstrap] CODESPACE_NAME=${CODESPACE_NAME:-unknown}"

# ============ 1) 环境变量 ============
export NODE_ENV=production
export PORT=3001
export HOST=0.0.0.0
export REDIS_URL=${REDIS_URL:-redis://127.0.0.1:6379}
export DATABASE_URL=${DATABASE_URL:-./data/chatroom.db}
# JWT_SECRET：若未设置则生成稳定值并写入 .env（避免每次重启用户被踢下线）
if [ -z "${JWT_SECRET:-}" ]; then
  if [ -f .env ] && grep -q "^JWT_SECRET=" .env; then
    export JWT_SECRET=$(grep "^JWT_SECRET=" .env | cut -d= -f2-)
  else
    JWT_SECRET="cs_$(openssl rand -hex 16)"
    echo "JWT_SECRET=$JWT_SECRET" >> .env
    export JWT_SECRET
  fi
fi

# ============ 2) Redis 拉起（Codespace 内置 feature 装了但可能没启动） ============
if ! command -v redis-cli >/dev/null 2>&1; then
  echo "[bootstrap] redis-cli 未安装，使用内存模式"
  export REDIS_URL=""
elif ! redis-cli -p 6379 ping >/dev/null 2>&1; then
  echo "[bootstrap] 启动本地 Redis"
  (redis-server --daemonize yes --save "" --appendonly no --maxmemory 64mb --maxmemory-policy allkeys-lru 2>/dev/null || true)
  sleep 1
  redis-cli -p 6379 ping >/dev/null 2>&1 && echo "[bootstrap] Redis 就绪" || echo "[bootstrap] Redis 启动失败，回退内存模式"
fi

# ============ 3) 补装 devDependencies（如果 install-deps 用了 --omit=dev） ============
# 在 Codespace 内运行时需要 tsx/typescript/vite，必须装 devDependencies
if [ ! -d node_modules/.bin ] || [ ! -f node_modules/tsx/dist/cli.mjs ]; then
  echo "[bootstrap] 补装 devDependencies（tsx/typescript/vite）"
  npm install --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund --omit=optional
fi

# ============ 4) 构建前端（如果 dist 缺失或源码比 dist 新） ============
REBUILD=0
if [ ! -f dist/index.html ]; then
  REBUILD=1
elif [ "$(find src api -name '*.tsx' -o -name '*.ts' -newer dist/index.html 2>/dev/null | head -1)" ]; then
  REBUILD=1
fi
if [ "$REBUILD" = "1" ]; then
  echo "[bootstrap] 构建前端产物"
  npx vite build 2>&1 | tail -5 || echo "[bootstrap] vite build 失败，将使用现有 dist（若有）"
fi

# ============ 5) 启动服务（lean 模式，省内存） ============
# 先杀掉旧实例避免端口占用
pkill -f "tsx api/server.ts" 2>/dev/null || true
sleep 1

mkdir -p logs data uploads

echo "[bootstrap] 启动 chatroom 服务（端口 3001）"
nohup node \
  --max-old-space-size=384 \
  --optimize-for-size \
  --max-semi-space-size=2 \
  --import tsx \
  api/server.ts \
  > logs/server.log 2>&1 &
SERVER_PID=$!
echo "[bootstrap] server PID=$SERVER_PID"
echo "$SERVER_PID" > .server.pid

# 等服务就绪（最多 30 秒）
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "[bootstrap] 服务就绪（用时 ${i}s）"
    break
  fi
  sleep 1
done

# ============ 6) 上报公开 URL 到仓库（双保险） ============
# Codespace 公开 URL 格式：https://<codespace-name>-3001.app.github.dev
# 重启后通常不变，但这里仍然上报一次，Worker 优先读这个文件
PUBLIC_URL=""
if [ -n "${CODESPACE_NAME:-}" ]; then
  # 通过 gh CLI 拿端口转发地址（最准）
  PUBLIC_URL=$(gh codespace ports 2>/dev/null | awk '$1=="3001"{print $3}' | head -1 || true)
  # 兜底：拼接标准格式
  if [ -z "$PUBLIC_URL" ]; then
    PUBLIC_URL="https://${CODESPACE_NAME}-3001.app.github.dev"
  fi
fi
if [ -n "$PUBLIC_URL" ]; then
  echo "[bootstrap] 公开 URL: $PUBLIC_URL"
  # 写入仓库文件（如果变了才 commit，避免每次启动产生空提交）
  if [ ! -f .codespace-url ] || [ "$(cat .codespace-url 2>/dev/null)" != "$PUBLIC_URL" ]; then
    echo "$PUBLIC_URL" > .codespace-url
    echo "$(date -u +%FT%TZ)" > .codespace-url-updated-at
    git add .codespace-url .codespace-url-updated-at 2>/dev/null || true
    git -c user.name="codespace-bot" -c user.email="codespace-bot@users.noreply.github.com" \
      commit -m "chore(codespace): update public url [skip ci]" 2>/dev/null || true
    git push origin HEAD:master 2>/dev/null || echo "[bootstrap] push 失败，Worker 将用默认 URL"
  fi
fi

# ============ 7) 拉起空闲守护（10 分钟无真实访问则停止 Codespace） ============
echo "[bootstrap] 启动空闲守护（10 分钟阈值）"
nohup node scripts/codespace-idle-watcher.mjs > logs/idle-watcher.log 2>&1 &
echo $! > .idle-watcher.pid

echo "[bootstrap] 全部就绪，服务地址: ${PUBLIC_URL:-http://localhost:3001}"
