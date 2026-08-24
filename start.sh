#!/data/data/com.termux/files/usr/bin/bash
cd /data/data/com.termux/files/home/chatroom
export NODE_ENV=production
export PATH=/data/data/com.termux/files/usr/bin:$PATH
exec /data/data/com.termux/files/usr/bin/node --env-file=.env --max-old-space-size=384 --optimize-for-size --import tsx /data/data/com.termux/files/home/chatroom/api/server.ts
