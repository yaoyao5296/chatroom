#!/data/data/com.termux/files/usr/bin/bash
export PATH="/data/data/com.termux/files/usr/bin:/data/data/com.termux/files/home/node_modules/.bin:$PATH"
cd /data/data/com.termux/files/home/chatroom
while true; do
  echo "[$(date '+%H:%M:%S')] 🚀 tunnel-zjp 启动: chatroomzjp0310.loca.lt"
  npx lt --subdomain chatroomzjp0310 --port 3001 2>&1
  echo "[$(date '+%H:%M:%S')] ⚠️ tunnel-zjp 断开，3秒后重连"
  sleep 3
done
