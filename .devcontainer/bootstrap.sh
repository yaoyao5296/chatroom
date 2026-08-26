#!/usr/bin/env bash
# Codespace 每次启动时运行 —— 装依赖 + 构建产物 + 启动服务 + 拉起空闲守护
set -uo pipefail

# ============ 0) PATH 修复（非交互式 ssh 不加载 nvm，需手动加 node/npm） ============
for p in /home/codespace/nvm/current/bin /usr/local/nodejs/current/bin /usr/local/bin; do
  [ -d "$p" ] && case ":$PATH:" in *":$p:"*) ;; *) PATH="$p:$PATH" ;; esac
done
export PATH
export NVM_DIR="${NVM_DIR:-/home/codespace/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true

echo "[bootstrap] 启动于 $(date -u +%FT%TZ)  node=$(node -v 2>/dev/null || echo '?')  npm=$(npm -v 2>/dev/null || echo '?')"

# 设置国内源加速
npm config set registry https://registry.npmmirror.com 2>/dev/null

# ============ 0.5) 确定项目根目录 ============
ROOT=""
for d in /workspaces/chatroom "${CODESPACE_VSCODE_FOLDER:-}" /workspace .; do
  [ -z "$d" ] && continue
  if [ -f "$d/package.json" ] && [ -f "$d/.devcontainer/bootstrap.sh" ]; then
    ROOT="$d"; break
  fi
done
if [ -z "$ROOT" ]; then
  echo "[bootstrap] ✘ 找不到项目根目录，退出"; exit 1
fi
cd "$ROOT"
echo "[bootstrap] 工作目录: $ROOT"

# ============ 0.7) 确定 CODESPACE_NAME ============
CODESPACE_NAME="${CODESPACE_NAME:-${CODESPACE:-}}"
# 兜底 1：Codespace 会把 name 写到 /etc/codespace-name
if [ -z "$CODESPACE_NAME" ] || [ "$CODESPACE_NAME" = "unknown" ]; then
  CODESPACE_NAME=$(cat /etc/codespace-name 2>/dev/null || echo "")
fi
# 兜底 2：/workspaces/.codespace 目录下的 name 文件（新版 codespace）
if [ -z "$CODESPACE_NAME" ] || [ "$CODESPACE_NAME" = "unknown" ]; then
  CODESPACE_NAME=$(cat /workspaces/.codespace/name 2>/dev/null || echo "")
fi
# 兜底 3：hostname 前缀（通常 codespace hostname 形如 codespaces-xxxxx，name 是另一形式；跳过）
# 兜底 4：通过 GitHub API 查（用 codespace 内的 GITHUB_TOKEN 或 GH_PAT）
if [ -z "$CODESPACE_NAME" ] || [ "$CODESPACE_NAME" = "unknown" ]; then
  _TOK="${GH_PAT:-${GITHUB_TOKEN:-}}"
  if [ -n "$_TOK" ]; then
    CODESPACE_NAME=$(curl -sS -m 8 -H "Authorization: Bearer $_TOK" \
      https://api.github.com/user/codespaces 2>/dev/null \
      | grep -oE '"name":"[^"]+"' | head -1 | cut -d'"' -f4 || true)
  fi
fi
export CODESPACE_NAME
echo "[bootstrap] CODESPACE_NAME=${CODESPACE_NAME:-unknown}"

# ============ 1) 环境变量 ============
export NODE_ENV=production
export PORT=3001
export HOST=0.0.0.0
export DATABASE_URL=${DATABASE_URL:-./data/chatroom.db}
export REDIS_URL=${REDIS_URL:-}

# 邮箱服务（163 SMTP）—— 授权码通过 Codespace secret 注入，绝不在代码中硬编码
# 设置方式（拿到带 codespace 权限的 PAT 后执行，授权码请另行提供，勿写入本文件）：
#   gh secret set MAIL_PASS -a codespaces -b "<你的163授权码>"
export MAIL_HOST="${MAIL_HOST:-smtp.163.com}"
export MAIL_PORT="${MAIL_PORT:-465}"
export MAIL_USER="${MAIL_USER:-13574196538@163.com}"
export MAIL_PASS="${MAIL_PASS:-}"
export MAIL_FROM="${MAIL_FROM:-${MAIL_USER}}"

# JWT_SECRET：稳定值写入 .env
if [ -z "${JWT_SECRET:-}" ]; then
  if [ -f .env ] && grep -q "^JWT_SECRET=" .env; then
    export JWT_SECRET=$(grep "^JWT_SECRET=" .env | cut -d= -f2-)
  else
    RAND_HEX=""
    if [ -r /dev/urandom ]; then
      RAND_HEX=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' 2>/dev/null || true)
    fi
    [ -z "$RAND_HEX" ] && RAND_HEX=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))" 2>/dev/null || echo "$(date +%s)$RANDOM" | md5sum | cut -c1-32)
    JWT_SECRET="cs_${RAND_HEX}"
    echo "JWT_SECRET=$JWT_SECRET" >> .env
    export JWT_SECRET
  fi
fi

# ============ 2) 安装 Redis（Codespace 默认镜像不带，需要 apt 安装） ============
if ! command -v redis-server >/dev/null 2>&1; then
  echo "[bootstrap] 安装 Redis"
  sudo apt-get update -qq 2>/dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y redis-server redis-tools >/dev/null 2>&1 || true
fi
# Redis 数据目录（node 用户可写，避免 /var/lib/redis 权限问题导致 RDB 加载失败）
mkdir -p "$ROOT/.redis-data"

# ============ 3) 安装依赖（强制装全，包括 devDependencies 用于构建） ============
# 检查关键构建工具是否就位（vite 是 devDependency）
NEED_INSTALL=0
if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
  NEED_INSTALL=1
elif [ ! -d node_modules/vite ] || [ ! -d node_modules/tsx ]; then
  NEED_INSTALL=1
fi
if [ "$NEED_INSTALL" = "1" ]; then
  echo "[bootstrap] 安装依赖（含 devDependencies，用于 vite 构建）"
  # Python 3.13+ 移除了 distutils，但 node-gyp 9.x 依赖它，编译 better-sqlite3 会失败
  # 装 setuptools 提供 distutils 兼容
  if ! python3 -c "import distutils" 2>/dev/null; then
    echo "[bootstrap] 安装 python3-setuptools（提供 distutils）"
    sudo apt-get update -qq 2>/dev/null && sudo apt-get install -y python3-setuptools >/dev/null 2>&1 || true
  fi
  # 临时切换 NODE_ENV=development，否则 npm 在 production 下会跳过 devDependencies
  ORIG_NODE_ENV="${NODE_ENV:-}"
  export NODE_ENV=development
  # 使用 --ignore-scripts 跳过 electron 下载（国内网络超时），后续单独编译 better-sqlite3
  npm install --no-audit --no-fund --include=dev --ignore-scripts 2>&1 | tail -5
  # 单独编译 better-sqlite3 原生模块
  if [ -d node_modules/better-sqlite3 ] && [ ! -f node_modules/better-sqlite3/build/Release/better_sqlite3.node ]; then
    echo "[bootstrap] 编译 better-sqlite3 原生模块"
    (cd node_modules/better-sqlite3 && npx --yes node-gyp rebuild --release 2>&1 | tail -3) || echo "[bootstrap] ⚠ better-sqlite3 编译失败"
  fi
  export NODE_ENV="$ORIG_NODE_ENV"
else
  echo "[bootstrap] node_modules 完整，跳过安装"
fi

# ============ 3.5) 构建前端（确保 JS 文件最新，避免白屏） ============
echo "[bootstrap] 构建前端..."
npx vite build 2>&1 | tail -3

# ============ 4) Redis 安装检查（install-deps.sh 已预装，这里只兜底） ============
if ! command -v redis-server >/dev/null 2>&1; then
  echo "[bootstrap] Redis 未装（install-deps.sh 可能未执行），快速安装"
  sudo apt-get update -qq 2>/dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y redis-server redis-tools >/dev/null 2>&1 || true
fi
mkdir -p "$ROOT/.redis-data"

# ============ 5) 启动服务（PM2 并行启动 redis + chatroom，端口设置后台执行） ============
# 清理残留进程
pkill -9 -f "tsx api/server.ts" 2>/dev/null || true
pkill -9 -f "redis-server.*6379" 2>/dev/null || true
pkill -9 -f "codespace-idle-watcher" 2>/dev/null || true
npx pm2 delete redis 2>/dev/null || true
npx pm2 delete chatroom 2>/dev/null || true
mkdir -p logs data uploads

# .env 回写 CODESPACE_NAME
if [ -n "$CODESPACE_NAME" ] && [ "$CODESPACE_NAME" != "unknown" ]; then
  if [ -f .env ] && grep -q "^CODESPACE_NAME=" .env 2>/dev/null; then
    sed -i "s|^CODESPACE_NAME=.*|CODESPACE_NAME=$CODESPACE_NAME|" .env 2>/dev/null || true
  else
    echo "CODESPACE_NAME=$CODESPACE_NAME" >> .env 2>/dev/null || true
  fi
fi

# 并行启动 Redis 和 chatroom（chatroom 内部会重试连接 Redis，无需等 Redis 就绪）
echo "[bootstrap] 并行启动 Redis + chatroom"
if command -v redis-server >/dev/null 2>&1; then
  npx pm2 start redis-server --name redis --interpreter none \
    -- --port 6379 --bind 127.0.0.1 --daemonize no --save "" --appendonly no \
    --dir "$ROOT/.redis-data" --maxmemory 64mb --maxmemory-policy allkeys-lru 2>&1 | tail -2
fi
if [ -f ecosystem.config.cjs ]; then
  npx pm2 start ecosystem.config.cjs 2>&1 | tail -3 &
else
  NODE_ARGS="--max-old-space-size=768 --import tsx"
  [ -f .env ] && NODE_ARGS="--env-file=.env $NODE_ARGS"
  npx pm2 start api/server.ts --name chatroom --interpreter node --interpreter-args "$NODE_ARGS" 2>&1 | tail -3 &
fi

# 前台设置端口 public（与 chatroom 冷启动并行执行，不增加额外时间）
if [ -n "$CODESPACE_NAME" ] && [ "$CODESPACE_NAME" != "unknown" ] && command -v gh >/dev/null 2>&1 && [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "[bootstrap] 设置端口 3001 为 public"
  echo "$GITHUB_TOKEN" | gh auth login --with-token 2>/dev/null
  gh codespace ports visibility 3001:public -c "$CODESPACE_NAME" 2>/dev/null && echo "[bootstrap] ✓ 端口已 public" || echo "[bootstrap] ⚠ 端口设置失败"
fi
wait  # 等 chatroom 启动完成

# 同步 REDIS_URL 到 .env
if redis-cli -p 6379 ping >/dev/null 2>&1; then
  export REDIS_URL="redis://127.0.0.1:6379"
  if [ -f .env ] && grep -q "^REDIS_URL=" .env 2>/dev/null; then
    sed -i "s|^REDIS_URL=.*|REDIS_URL=$REDIS_URL|" .env 2>/dev/null || true
  else
    echo "REDIS_URL=$REDIS_URL" >> .env 2>/dev/null || true
  fi
fi

# 等服务就绪（最多 30 秒）
READY=0
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "[bootstrap] ✓ chatroom 就绪（用时 ${i}s）"
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" = "0" ]; then
  echo "[bootstrap] ✘ chatroom 未就绪，最近日志："
  npx pm2 logs chatroom --lines 15 --nostream 2>&1 | tail -20
fi

# 保存 PM2 进程列表
npx pm2 save 2>&1 | tail -2

# ============ 5.5) Bore pub 端口转发（3001 -> bore.pub:31425，免 GitHub 登录访问） ============
# Bore 让访问者无需登录 GitHub 即可访问 chatroom，替换 Cloudflare Tunnel 方案
BORE_BIN="/usr/local/bin/bore"
if [ ! -x "$BORE_BIN" ]; then
  echo "[bootstrap] 安装 Bore 预编译二进制"
  BORE_VERSION="0.5.1"
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64)  BORE_TAR="bore-v${BORE_VERSION}-x86_64-unknown-linux-musl.tar.gz" ;;
    aarch64|arm64) BORE_TAR="bore-v${BORE_VERSION}-aarch64-unknown-linux-musl.tar.gz" ;;
    *)             BORE_TAR="bore-v${BORE_VERSION}-x86_64-unknown-linux-musl.tar.gz" ;;
  esac
  curl -fsSL "https://github.com/ekzhang/bore/releases/download/v${BORE_VERSION}/${BORE_TAR}" \
    | sudo tar xz -C /usr/local/bin/ 2>/dev/null \
    && sudo chmod +x "$BORE_BIN" 2>/dev/null \
    || echo "[bootstrap] ⚠ Bore 二进制下载失败"
fi

# 启动 Bore 转发：本地 3001 -> bore.pub，请求固定端口 31425
# 用 PM2 管理 bore 进程（daemon 独立于 SSH 会话，避免 SSH 退出被杀）
if [ -x "$BORE_BIN" ]; then
  npx pm2 delete bore 2>/dev/null || true
  npx pm2 delete bore-socat 2>/dev/null || true

  # 先启动 socat 代理隧道（bore.pub:7835 需要走 HTTP 代理）
  echo "[bootstrap] 启动 socat 代理隧道（bore.pub:7835 -> 127.0.0.1:7835）"
  if command -v socat >/dev/null 2>&1; then
    npx pm2 start socat --name bore-socat --interpreter none -- \
      TCP-LISTEN:7835,fork,reuseaddr "PROXY:127.0.0.1:bore.pub:7835,proxyport=18080" 2>&1 | tail -2
    sleep 2
  fi

  echo "[bootstrap] 启动 Bore 转发（local 3001 -> bore.pub:31425）"
  npx pm2 start "$BORE_BIN" --name bore --interpreter none -- local 3001 --to 127.0.0.1 --port 31425 2>&1 | tail -2
  # 等待 Bore 连接建立并探测转发是否就绪（直接请求 bore.pub:31425 的 health 接口）
  BORE_URL="http://bore.pub:31425"
  BORE_OK=0
  for i in $(seq 1 15); do
    if curl -sf -m 3 "$BORE_URL/api/health" >/dev/null 2>&1; then
      BORE_OK=1; break
    fi
    sleep 1
  done
  if [ "$BORE_OK" = "1" ]; then
    echo "[bootstrap] ✓ Bore 转发就绪: $BORE_URL"
    echo "$BORE_URL" > .bore-url
  else
    echo "[bootstrap] ⚠ Bore 转发未就绪，最近日志："
    npx pm2 logs bore --lines 5 --nostream 2>&1 | tail -8
  fi
else
  echo "[bootstrap] ⚠ Bore 未安装，跳过端口转发"
fi

# ============ 6) 写入公开 URL 到本地文件（优先使用 Bore URL，无需 GitHub 登录） ============
PUBLIC_URL=""
# 优先使用 Bore 转发地址（免登录）
if [ -f .bore-url ]; then
  PUBLIC_URL=$(cat .bore-url 2>/dev/null)
fi
# 兜底：使用 Codespace 原生公开 URL（需登录 GitHub）
if [ -z "$PUBLIC_URL" ] && [ -n "$CODESPACE_NAME" ] && [ "$CODESPACE_NAME" != "unknown" ]; then
  PUBLIC_URL="https://${CODESPACE_NAME}-3001.app.github.dev"
fi
if [ -n "$PUBLIC_URL" ]; then
  echo "$PUBLIC_URL" > .codespace-url
  echo "[bootstrap] 公开 URL: $PUBLIC_URL"
fi

# ============ 7) 拉起空闲守护 ============
# 空闲守护需要 GH_PAT 才能真正停止 codespace，缺失时仅告警
if [ -n "${GH_PAT:-}" ]; then
  echo "[bootstrap] 启动空闲守护（10 分钟阈值）"
  nohup node scripts/codespace-idle-watcher.mjs > logs/idle-watcher.log 2>&1 &
  echo $! > .idle-watcher.pid
else
  echo "[bootstrap] ⚠ GH_PAT 未设置，空闲守护不会真正停止 codespace（仅记录日志）"
  nohup node scripts/codespace-idle-watcher.mjs > logs/idle-watcher.log 2>&1 &
  echo $! > .idle-watcher.pid
fi

# ============ 8) 启动看门狗（PM2 守护，崩溃自动重启） ============
WATCHDOG_SH="$ROOT/.devcontainer/watchdog.sh"
if [ -x "$WATCHDOG_SH" ]; then
  chmod +x "$WATCHDOG_SH" 2>/dev/null
  npx pm2 delete watchdog 2>/dev/null || true
  echo "[bootstrap] 启动看门狗（每 30 秒检查服务+隧道）"
  npx pm2 start "$WATCHDOG_SH" --name watchdog --interpreter bash 2>&1 | tail -2
  npx pm2 save 2>&1
fi

echo "[bootstrap] 完成，服务地址: ${PUBLIC_URL:-http://localhost:3001}"
