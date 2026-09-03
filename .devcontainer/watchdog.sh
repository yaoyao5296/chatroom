#!/usr/bin/env bash
# PM2 看门狗 —— 每 30 秒检查服务 + bore 隧道，崩溃自动重启
# 由 bootstrap.sh 通过 PM2 启动
set -uo pipefail

ROOT=""
for d in /workspaces/chatroom /workspace .; do
  [ -z "$d" ] && continue
  [ -f "$d/package.json" ] && ROOT="$d" && break
done
[ -z "$ROOT" ] && echo "[watchdog] 找不到项目根目录" && exit 1
cd "$ROOT" || exit 1

# PATH 修复
for p in /home/codespace/nvm/current/bin /usr/local/nodejs/current/bin /usr/local/bin; do
  [ -d "$p" ] && case ":$PATH:" in *":$p:"*) ;; *) PATH="$p:$PATH" ;; esac
done
export PATH

# 导入环境变量
[ -f .env ] && export $(grep -v '^#' .env | xargs 2>/dev/null) || true

while true; do
  # 检查服务是否就绪
  CHATROOM_OK=0
  BORE_OK=0

  curl -sf http://localhost:3001/api/health >/dev/null 2>&1 && CHATROOM_OK=1
  curl -sf -m 5 http://bore.pub:31425/api/health >/dev/null 2>&1 && BORE_OK=1

  NOW=$(date +%FT%T%z)

  if [ "$CHATROOM_OK" = "0" ]; then
    echo "[watchdog $NOW] ⚠ chatroom 服务未响应，重启..."
    npx pm2 delete chatroom 2>/dev/null || true
    NODE_ARGS="--max-old-space-size=128 --optimize-for-size --max-semi-space-size=1 --initial-old-space-size=64 --import tsx"
    [ -f .env ] && NODE_ARGS="--env-file=.env $NODE_ARGS"
    npx pm2 start api/server.ts --name chatroom --interpreter node --interpreter-args "$NODE_ARGS" 2>&1 | tail -1
  fi

  if [ "$BORE_OK" = "0" ]; then
    echo "[watchdog $NOW] ⚠ bore 隧道未响应，重启..."
    npx pm2 delete bore 2>/dev/null || true
    sleep 1
    npx pm2 start /usr/local/bin/bore --name bore --interpreter none -- local 3001 --to bore.pub --port 31425 2>&1 | tail -1
  fi

  # Ollama 健康检查
  if command -v ollama >/dev/null 2>&1; then
    OLLAMA_OK=0
    curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && OLLAMA_OK=1
    if [ "$OLLAMA_OK" = "0" ]; then
      echo "[watchdog $NOW] ⚠ Ollama 未响应，重启..."
      npx pm2 delete ollama 2>/dev/null || true
      sleep 1
      npx pm2 start ollama --name ollama --interpreter none -- serve 2>&1 | tail -1
    fi
  fi

  sleep 30
done