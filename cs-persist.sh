#!/bin/bash
set -u
CS="chatroom-qvqrr4p54q7jh46r6"
REMOTE_SCRIPT=$(cat <<'BASH_EOF'
echo '==== 🛠 配置 Codespace 自启动（每次醒来自动起 chatroom + bore）===='
set +e

PM2=""
for p in \
  /workspaces/chatroom/node_modules/.bin/pm2 \
  $HOME/.local/bin/pm2 \
  $HOME/.npm/bin/pm2 \
  /usr/local/bin/pm2 \
  /usr/bin/pm2; do
  [ -x "$p" ] && { PM2="$p"; break; }
done
if [ -z "$PM2" ]; then
  echo "  (没有 pm2，走 npx 安装路径)"
  which npx && npm ls -g --depth=0 2>/dev/null | grep pm2 || true
  PM2="npx --yes pm2"
fi
echo "  PM2=$PM2"
echo ""

echo '--- [1] 用 PM2 启动 chatroom (生产模式 port 3001) ---'
cd /workspaces/chatroom || exit 2
# 先删掉同名旧进程
$PM2 delete chatroom-app 2>/dev/null || true
$PM2 start npm --name chatroom-app --cwd /workspaces/chatroom -- start -- 2>&1 | tail -8
echo ""

echo '--- [2] 用 PM2 启动 bore 隧道 3001→bore.pub:31425 ---'
$PM2 delete bore-tunnel 2>/dev/null || true
$PM2 start bore --name bore-tunnel -- local 3001 --to bore.pub --port 31425 -- 2>&1 | tail -8
echo ""

sleep 5
echo '--- [3] PM2 列表 ---'
$PM2 list 2>&1 | head -20
echo '--- [4] PM2 logs 最新 10 行 ---'
$PM2 logs --nostream --lines 15 --nostream 2>&1 | tail -20
echo ""

echo '--- [5] PM2 save (保存到 ~/.pm2/dump.pm2，下次唤醒 pm2 resurrect 可恢复) ---'
$PM2 save 2>&1 | tail -5
ls -la $HOME/.pm2/dump.pm2 2>&1 || true
echo ""

echo '--- [6] 部署自启动钩子 ①：~/.bashrc.d/ 新建 99-autostart.sh ---'
mkdir -p $HOME/.bashrc.d
cat > $HOME/.bashrc.d/99-autostart.sh <<'INNER'
# 每次 Codespace 启动都会触发 bashrc，执行一次拉起（幂等）
LOCK=/tmp/.autostart.lock
(flock -n 9 || exit 0
# 3001 没起 → PM2 resurrect
if ! curl -sS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
  echo "[autostart] 3001 无响应，运行 PM2 resurrect..."
  if [ -x /workspaces/chatroom/node_modules/.bin/pm2 ]; then
    /workspaces/chatroom/node_modules/.bin/pm2 resurrect >> /tmp/autostart.log 2>&1
  else
    npx --yes pm2 resurrect >> /tmp/autostart.log 2>&1
  fi
  sleep 10
fi
# bore 进程存在吗？没存在就 pm2 restart bore-tunnel
if ! pgrep -x bore >/dev/null; then
  echo "[autostart] bore 不在，尝试 restart..."
  if [ -x /workspaces/chatroom/node_modules/.bin/pm2 ]; then
    /workspaces/chatroom/node_modules/.bin/pm2 restart bore-tunnel >> /tmp/autostart.log 2>&1
  else
    npx --yes pm2 restart bore-tunnel >> /tmp/autostart.log 2>&1
  fi
fi
) 9>$LOCK
INNER
chmod +x $HOME/.bashrc.d/99-autostart.sh
ls -la $HOME/.bashrc.d/99-autostart.sh
echo ""

echo '--- [7] 部署自启动钩子 ②：~/.profile 末尾追加触发 ---'
# 保证即使是 non-login shell，.bashrc 里也能加载 .bashrc.d/*
if ! grep -q "bashrc.d" $HOME/.bashrc 2>/dev/null; then
  cat >> $HOME/.bashrc <<'INNER'

# Codespace 自启动钩子（加载 ~/.bashrc.d/*.sh）
if [ -d "$HOME/.bashrc.d" ]; then
  for f in $HOME/.bashrc.d/*.sh; do
    [ -r "$f" ] && . "$f"
  done
  unset f
fi
INNER
fi
tail -12 $HOME/.bashrc
echo ""

echo '--- [8] 立即等 15 秒，验证 PM2 下两个服务 3001 + bore 都 OK ---'
sleep 15
echo "PM2 健康度:"
$PM2 list 2>&1 | tail -15
echo ""
echo "本地 HTTP 健康:"
curl -sS --max-time 5 -w "\nHTTP=%{http_code}\n" http://127.0.0.1:3001/api/health
echo "bore 隧道出口:"
curl -sS --max-time 8 -w "\nHTTP=%{http_code}\n" http://bore.pub:31425/api/health

echo ""
echo '==== 🔚 持久化配置完成 ===='
BASH_EOF
)

MAX=10
for i in $(seq 1 $MAX); do
  echo ""
  echo "==== 🤝 第 $i/$MAX 次尝试 SSH ===="
  timeout 240 gh codespace ssh -c "$CS" --server-port 0 -- "bash -lc $(printf "%q" "$REMOTE_SCRIPT")"
  RC=$?
  echo "==== rc=$RC ===="
  if [ $RC -eq 0 ]; then exit 0; fi
  sleep 5
done
echo "❌ 连接全部失败"
exit 4
