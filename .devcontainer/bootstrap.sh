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
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund --include=dev 2>&1 | tail -5 || npm install --no-audit --no-fund --include=dev 2>&1 | tail -5
  else
    npm install --no-audit --no-fund --include=dev 2>&1 | tail -5
  fi
  # 确保 better-sqlite3 原生模块编译完成
  if [ ! -f node_modules/better-sqlite3/build/Release/better_sqlite3.node ]; then
    echo "[bootstrap] 编译 better-sqlite3 原生模块"
    (cd node_modules/better-sqlite3 && npx --yes node-gyp rebuild --release 2>&1 | tail -3) || echo "[bootstrap] ⚠ better-sqlite3 编译失败"
  fi
  export NODE_ENV="$ORIG_NODE_ENV"
else
  echo "[bootstrap] node_modules 完整，跳过安装"
fi

# ============ 4) 构建前端 ============
REBUILD=0
if [ ! -f dist/index.html ]; then
  REBUILD=1
elif [ -n "$(find src api -name '*.tsx' -o -name '*.ts' -newer dist/index.html 2>/dev/null | head -1)" ]; then
  REBUILD=1
fi
if [ "$REBUILD" = "1" ]; then
  echo "[bootstrap] 构建前端产物"
  if ! npx vite build 2>&1 | tail -10; then
    echo "[bootstrap] ⚠ vite build 失败，尝试用现有 dist"
  fi
fi

# ============ 5) 启动服务（PM2 统一管理 Redis + chatroom） ============
# 清理可能残留的旧进程（setsid 方式或之前的 PM2 进程）
pkill -9 -f "tsx api/server.ts" 2>/dev/null || true
pkill -9 -f "redis-server.*6379" 2>/dev/null || true
pkill -9 -f "codespace-idle-watcher" 2>/dev/null || true
# 停止并删除 PM2 中已有的同名进程（避免重复启动报错）
npx pm2 delete redis 2>/dev/null || true
npx pm2 delete chatroom 2>/dev/null || true
sleep 1
mkdir -p logs data uploads

# .env 里可能写了 MAIL_* / GH_PAT，优先级最高：让 node 通过 --env-file 加载
# 另外设置 CODESPACE_NAME 回写到 .env（保证启动脚本与 .env 同步）
if [ -n "$CODESPACE_NAME" ] && [ "$CODESPACE_NAME" != "unknown" ]; then
  # 已存在则更新；不存在则追加
  if [ -f .env ] && grep -q "^CODESPACE_NAME=" .env 2>/dev/null; then
    sed -i "s|^CODESPACE_NAME=.*|CODESPACE_NAME=$CODESPACE_NAME|" .env 2>/dev/null || true
  else
    echo "CODESPACE_NAME=$CODESPACE_NAME" >> .env 2>/dev/null || true
  fi
fi

# 启动 Redis（PM2 管理，崩溃自动重启；指定 --dir 到可写目录避免 RDB 权限问题）
if command -v redis-server >/dev/null 2>&1; then
  echo "[bootstrap] 启动 Redis（PM2 管理）"
  npx pm2 start redis-server --name redis --interpreter none \
    -- --port 6379 --bind 127.0.0.1 --daemonize no --save "" --appendonly no \
    --dir "$ROOT/.redis-data" --maxmemory 64mb --maxmemory-policy allkeys-lru 2>&1 | tail -3
  sleep 2
  if redis-cli -p 6379 ping >/dev/null 2>&1; then
    export REDIS_URL="redis://127.0.0.1:6379"
    # 同步到 .env
    if [ -f .env ] && grep -q "^REDIS_URL=" .env 2>/dev/null; then
      sed -i "s|^REDIS_URL=.*|REDIS_URL=$REDIS_URL|" .env 2>/dev/null || true
    else
      echo "REDIS_URL=$REDIS_URL" >> .env 2>/dev/null || true
    fi
    echo "[bootstrap] ✓ Redis 就绪"
  else
    echo "[bootstrap] ⚠ Redis 启动失败，chatroom 将回退内存模式"
  fi
fi

# 启动 chatroom（PM2 管理，用 ecosystem.config.cjs 定义）
echo "[bootstrap] 启动 chatroom 服务（PM2 管理，端口 3001）"
if [ -f ecosystem.config.cjs ]; then
  npx pm2 start ecosystem.config.cjs 2>&1 | tail -5
else
  # 兜底：直接用 pm2 start
  NODE_ARGS="--max-old-space-size=768 --import tsx"
  [ -f .env ] && NODE_ARGS="--env-file=.env $NODE_ARGS"
  npx pm2 start api/server.ts --name chatroom --interpreter node --interpreter-args "$NODE_ARGS" 2>&1 | tail -5
fi

# 等服务就绪（最多 60 秒，PM2 + tsx 冷启动较慢）
READY=0
for i in $(seq 1 60); do
  if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "[bootstrap] ✓ chatroom 就绪（用时 ${i}s）"
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" = "0" ]; then
  echo "[bootstrap] ✘ chatroom 未就绪，最近日志："
  npx pm2 logs chatroom --lines 20 --nostream 2>&1 | tail -25
fi

# 保存 PM2 进程列表（下次 Codespace 启动时 PM2 resurrection 会自动恢复）
npx pm2 save 2>&1 | tail -2

# 设置端口 3001 为 public（Codespace 重启后端口可见性会重置为 private）
if [ -n "$CODESPACE_NAME" ] && [ "$CODESPACE_NAME" != "unknown" ]; then
  echo "[bootstrap] 设置端口 3001 为 public"
  gh codespace ports visibility 3001:public -c "$CODESPACE_NAME" 2>/dev/null || true
fi

# ============ 6) 写入公开 URL 到本地文件（不 push，由外部读取或 GitHub API 查） ============
PUBLIC_URL=""
if [ -n "$CODESPACE_NAME" ] && [ "$CODESPACE_NAME" != "unknown" ]; then
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

echo "[bootstrap] 完成，服务地址: ${PUBLIC_URL:-http://localhost:3001}"
