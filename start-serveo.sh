#!/data/data/com.termux/files/usr/bin/bash
# serveo 隧道脚本 - 支持固定子域名，自动重连，兼容 Termux
set -u

PORT="${1:-3001}"
SUB1="${2:-chatroomzjp}"
SUB2="${3:-chatroomcloud}"

LOGFILE="/data/data/com.termux/files/home/.pm2/logs/serveo.log"
mkdir -p "$(dirname "$LOGFILE")"

echo "[$(date '+%H:%M:%S')] 🚀 启动 serveo 隧道: ${SUB1}.serveo.net + ${SUB2}.serveo.net -> localhost:${PORT}"

while true; do
  echo "[$(date '+%H:%M:%S')] 🔌 连接 serveo 服务器..."
  ssh -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=2 \
      -o ConnectTimeout=15 \
      -o ExitOnForwardFailure=yes \
      -T serveo.net \
      -R "${SUB1}:80:localhost:${PORT}" \
      -R "${SUB2}:80:localhost:${PORT}" \
      -n -N 2>&1 | tee -a "$LOGFILE"

  EXIT_CODE=${PIPESTATUS[0]}
  echo "[$(date '+%H:%M:%S')] ⚠️  serveo 断开(exit=$EXIT_CODE)，3秒后重连..."
  sleep 3
done
