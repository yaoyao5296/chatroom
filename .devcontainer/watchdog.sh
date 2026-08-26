#!/usr/bin/env bash
# PM2 看门狗 —— 每 30 秒检查服务 + bore 隧道，崩溃自动重启
# 由 bootstrap.sh 通过 PM2 启动
set -uo pipefail

ROOT="/workspace"
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
  SOCAT_OK=0

  curl -sf http://localhost:3001/api/health >/dev/null 2>&1 && CHATROOM_OK=1
  curl -sf -m 5 http://bore.pub:31425/api/health >/dev/null 2>&1 && BORE_OK=1
  # 检查 socat 是否在监听
  timeout 2 bash -c "echo | nc -w 1 127.0.0.1 7835" 2>/dev/null && SOCAT_OK=1

  NOW=$(date +%FT%T%z)

  if [ "$CHATROOM_OK" = "0" ]; then
    echo "[watchdog $NOW] ⚠ chatroom 服务未响应，重启..."
    npx pm2 delete chatroom 2>/dev/null || true
    NODE_ARGS="--max-old-space-size=128 --optimize-for-size --max-semi-space-size=1 --initial-old-space-size=64 --import tsx"
    [ -f .env ] && NODE_ARGS="--env-file=.env $NODE_ARGS"
    npx pm2 start api/server.ts --name chatroom --interpreter node --interpreter-args "$NODE_ARGS" 2>&1 | tail -1
  fi

  if [ "$SOCAT_OK" = "0" ] && command -v socat >/dev/null 2>&1; then
    echo "[watchdog $NOW] ⚠ socat 代理未运行，重启..."
    npx pm2 delete bore-socat 2>/dev/null || true
    npx pm2 start socat --name bore-socat --interpreter none -- \
      TCP-LISTEN:7835,fork,reuseaddr "PROXY:127.0.0.1:bore.pub:7835,proxyport=18080" 2>&1 | tail -1
    sleep 2
  fi

  if [ "$BORE_OK" = "0" ]; then
    echo "[watchdog $NOW] ⚠ bore 隧道未响应，重启..."
    npx pm2 delete bore 2>/dev/null || true
    sleep 1
    /usr/local/bin/bore local 3001 --to 127.0.0.1 --port 31425 > /tmp/bore-watchdog.log 2>&1 &
    # 不用 PM2 重启 bore（PM2 的 interpreter none 可能无法正确处理 bore 的 stdio）
    # 直接用后台进程方式，同时在 PM2 中保留一个占位
    npx pm2 start /usr/local/bin/bore --name bore --interpreter none -- local 3001 --to 127.0.0.1 --port 31425 2>&1 | tail -1
  fi

  sleep 30
done