#!/bin/bash
# cs-run.sh CMD  ——  跑 Codespace 远程命令，带重试，每 3 秒显示状态，有输出
set -u
CS="chatroom-qvqrr4p54q7jh46r6"
MAX=8
WAIT=4

echo "▶ cs-run: $*"
for i in $(seq 1 $MAX); do
  echo "   [$i/$MAX] 尝试..."
  OUT=$(timeout 45 gh codespace ssh -c "$CS" --server-port 0 -- "$@" 2>&1)
  RC=$?
  # 如果有 gh 报错但输出里有真实 stdout（比如 Connection Details + 实际命令 stdout），也认为 OK
  if [ $RC -eq 0 ] && echo "$OUT" | grep -qv "context deadline exceeded" && echo "$OUT" | grep -qv "error getting ssh server details"; then
    echo "   ✅ rc=0"
    echo "$OUT" | sed 's/^/     /'
    echo "   ───── end ─────"
    echo "$OUT"
    exit 0
  fi
  echo "   ❌ rc=$RC 输出里没成功，等 ${WAIT}s 后重试"
  echo "$OUT" | sed 's/^/     /' | tail -5
  sleep $WAIT
done
echo "❌ 重试 $MAX 次仍失败" >&2
echo "$OUT"
exit 1
