#!/data/data/com.termux/files/usr/bin/bash
export HOME="/data/data/com.termux/files/home"
export PATH="/data/data/com.termux/files/usr/bin:$PATH"
LOG="$HOME/.pm2/logs/serveo-tunnels.log"
mkdir -p "$(dirname "$LOG")"
touch "$LOG"

while true; do
  TS="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$TS] 🚀 START 双前缀 (chatroomzjp0310 + chatroomzjp0425) -> 127.0.0.1:3001" | tee -a "$LOG"

  stdbuf -oL -eL ssh -tt \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile="$HOME/.ssh/known_hosts" \
      -o ServerAliveInterval=20 \
      -o ServerAliveCountMax=2 \
      -o ConnectTimeout=15 \
      -o ExitOnForwardFailure=yes \
      -o TCPKeepAlive=yes \
      -i "$HOME/.ssh/id_ed25519" \
      serveo.net \
      -R chatroomzjp0310:80:127.0.0.1:3001 \
      -R chatroomzjp0425:80:127.0.0.1:3001 \
      -N 2>&1 | stdbuf -oL -eL tee -a "$LOG"

  EXIT=${PIPESTATUS[0]}
  TS="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$TS] ⚠️ 断开(exit=$EXIT)，3秒后重连" | tee -a "$LOG"
  sleep 3
done
