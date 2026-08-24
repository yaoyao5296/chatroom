#!/bin/bash
set -u
CS="chatroom-qvqrr4p54q7jh46r6"
# 这个大脚本在一个 Codespace SSH 会话里完整执行，避免反复建连接
REMOTE_SCRIPT=$(cat <<'BASH_EOF'
echo '==== 🚀 Codespace 启动脚本开始 ===='
set +e
cd /workspaces/chatroom || { echo "❌ cd 失败"; exit 2; }

echo '--- [1] Kill 旧进程 (按端口/精确进程名，避免脚本本身被误杀) ---'
fuser -k 3001/tcp 2>/dev/null || true
fuser -k 6379/tcp 2>/dev/null || true
pkill -9 -x bore 2>/dev/null || true
sleep 3
echo "  残留进程："
ps aux | grep -E "node|npm|bore" | grep -v grep | head -10 || true

echo ''
echo '--- [2] 启动 chatroom 服务 (npm start，生产模式 3001) ---'
setsid nohup bash -c "cd /workspaces/chatroom && npm start > /tmp/chatroom.log 2>&1" </dev/null >/dev/null 2>&1 &
disown
CR=$!
echo "  PID=$CR"
sleep 2

echo ''
echo '--- [3] 轮询等待 /api/health (每 2 秒，最多 30 次 = 60 秒) ---'
OK3001=0
for i in $(seq 1 30); do
  sleep 2
  CODE=$(curl -sS --max-time 2 -o /tmp/crh -w "%{http_code}" http://127.0.0.1:3001/api/health 2>/dev/null || echo 000)
  echo "  wait#$i code=$CODE"
  if [ "$CODE" = "200" ]; then
    echo "  ✅ /api/health 返回:"; cat /tmp/crh; echo ""
    OK3001=1
    break
  fi
done
if [ $OK3001 -eq 0 ]; then
  echo "  ❌ 3001 起不来，chatroom.log 最后 50 行:"
  tail -50 /tmp/chatroom.log 2>/dev/null
fi

echo ''
echo '--- [4] 启动 bore.pub 隧道 3001 → bore.pub:31425 ---'
which bore
bore --version 2>&1 | head -1
setsid bore local 3001 --to bore.pub --port 31425 </dev/null > /tmp/bore.log 2>&1 &
disown
BPID=$!
echo "  bore PID=$BPID"
echo "  等 bore 握手 12 秒..."
sleep 12
echo "  bore.log 前 30 行:"
head -30 /tmp/bore.log

echo ''
echo '--- [5] Codespace 内自测 bore 出口是否通 ---'
OKBORE=0
for i in 1 2 3 4 5; do
  sleep 3
  BCODE=$(curl -sS --max-time 8 -o /tmp/bh -w "%{http_code}" http://bore.pub:31425/api/health 2>/dev/null || echo 000)
  echo "  self-test#$i bore.pub:31425/api/health HTTP=$BCODE"
  if [ "$BCODE" = "200" ]; then
    echo "  ✅ 公网自测成功！body="; cat /tmp/bh; echo ""
    OKBORE=1
    break
  fi
done
if [ $OKBORE -eq 0 ]; then
  echo "  自测失败，/tmp/bh 内容:"; cat /tmp/bh 2>/dev/null | head -20; echo ""
  echo "  bore.log 最后 20 行:"
  tail -20 /tmp/bore.log
fi

echo ''
echo "==== 🔚 远程脚本结束 chatroomOK=$OK3001 boreOK=$OKBORE ===="
BASH_EOF
)

MAX=10
for i in $(seq 1 $MAX); do
  echo ""
  echo "==== 🤝 第 $i/$MAX 次尝试建立 Codespace SSH 连接并跑完整脚本 ===="
  timeout 180 gh codespace ssh -c "$CS" --server-port 0 -- "bash -lc $(printf "%q" "$REMOTE_SCRIPT")"
  RC=$?
  echo ""
  echo "==== 远程执行 rc=$RC ===="
  if [ $RC -eq 0 ]; then
    echo "✅ rc=0，连接 & 脚本都执行完成（OK3001/OKBORE 看上面输出即可）"
    exit 0
  fi
  sleep 5
done
echo "❌ 连接重试 $MAX 次失败"
exit 3
