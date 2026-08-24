#!/bin/sh
# Codespace: trae-clean -> trae-clean2 + reload PM2 chatroom-app (保持 bore/redis/邮箱不丢)
set -u
cd /workspaces/chatroom
echo "[0] before: branch=$(git branch --show-current) commit=$(git rev-parse HEAD 2>/dev/null || echo none)"

echo "[1] 先把 bore/redis pid 写入临时，避免 bore 隧道被中断"
pgrep -x bore >/dev/null && echo "  bore alive pid=$(pgrep -x bore)"
pgrep -x redis-server >/dev/null && echo "  redis alive pid=$(pgrep -x redis-server)"
curl -sS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1 && echo "  chatroom 3001 alive (before switch)" || echo "  ⚠️ chatroom 3001 dead (before switch)"

echo "[2] git fetch origin/trae-clean2（depth=1）+ 切分支（允许 reset --hard，保留 home/profile.d 不在 git 里的配置）"
git fetch origin trae-clean2 --depth 1 2>&1 | tail -2
FH=$(git rev-parse FETCH_HEAD)
echo "  FETCH_HEAD=$FH"
# 先 stash 当前可能的本地改动（devcontainer 已经在 trae-clean 应用过一次；ChatRoom.apk 也在）
git stash push -u -m "pre-trae-clean2" 2>&1 | tail -3
# 切 trae-clean2（存在则 checkout + reset，不存在则 switch）
if git show-ref --verify --quiet refs/heads/trae-clean2; then
  git checkout trae-clean2 2>&1 | tail -3
  git reset --hard FETCH_HEAD 2>&1 | tail -3
else
  git switch -c trae-clean2 FETCH_HEAD 2>&1 | tail -3
fi
echo "  after: branch=$(git branch --show-current) commit=$(git rev-parse HEAD)"

echo "[3] 带回 stash（devcontainer.json / ChatRoom.apk / bore pid files）"
git stash pop 2>&1 | tail -3

echo "[4] 邮箱自启动 HOME级 配置再幂等写一次（防止 git reset 清掉它们 —— 实际它们不在仓库里）"
mkdir -p $HOME/.bashrc.d
# 邮箱 env：先从 .env 读，没有就从当前 env 读
MAIL_HOST=${MAIL_HOST:-} ; MAIL_PORT=${MAIL_PORT:-} ; MAIL_USER=${MAIL_USER:-}
MAIL_PASS=${MAIL_PASS:-} ; MAIL_FROM=${MAIL_FROM:-}
ENV_FILE=/workspaces/chatroom/.env
if [ -f "$ENV_FILE" ]; then
  # 只提取 MAIL_*，避免 .env 里 shell 语法错误
  MAIL_HOST=$(grep -E '^MAIL_HOST=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  MAIL_PORT=$(grep -E '^MAIL_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  MAIL_USER=$(grep -E '^MAIL_USER=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  MAIL_PASS=$(grep -E '^MAIL_PASS=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  MAIL_FROM=$(grep -E '^MAIL_FROM=' "$ENV_FILE" | head -1 | cut -d= -f2-)
fi
TMP=/tmp/98-mail-env.sh
cat > "$TMP" <<EOF
# 邮件配置（163），非登录 shell 也能读到
export MAIL_HOST=$MAIL_HOST
export MAIL_PORT=$MAIL_PORT
export MAIL_USER=$MAIL_USER
export MAIL_PASS=$MAIL_PASS
export MAIL_FROM=$MAIL_FROM
EOF
cp "$TMP" $HOME/.bashrc.d/98-mail-env.sh && chmod +x $HOME/.bashrc.d/98-mail-env.sh
sudo -n cp "$TMP" /etc/profile.d/99-mail-env.sh 2>/dev/null && sudo -n chmod +x /etc/profile.d/99-mail-env.sh && echo "  全局 /etc/profile.d/99-mail-env.sh 已写" || echo "  （全局跳过，home 级已生效）"
rm -f "$TMP"
echo "  邮箱 MAIL_HOST=$MAIL_HOST MAIL_PORT=$MAIL_PORT MAIL_USER=$MAIL_USER MAIL_FROM=$MAIL_FROM"

# 99-autostart.sh home 级
cat > $HOME/.bashrc.d/99-autostart.sh <<'SH'
LOCK=/tmp/.autostart.lock
(flock -n 9 || exit 0
if ! curl -sS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
  echo "[autostart] 3001 dead -> pm2 resurrect" >> /tmp/autostart.log
  if [ -x /workspaces/chatroom/node_modules/.bin/pm2 ]; then
    /workspaces/chatroom/node_modules/.bin/pm2 resurrect >> /tmp/autostart.log 2>&1
  else
    npx --yes pm2 resurrect >> /tmp/autostart.log 2>&1
  fi
  sleep 10
fi
if ! pgrep -x bore >/dev/null; then
  echo "[autostart] bore dead -> pm2 restart bore-tunnel" >> /tmp/autostart.log
  if [ -x /workspaces/chatroom/node_modules/.bin/pm2 ]; then
    /workspaces/chatroom/node_modules/.bin/pm2 restart bore-tunnel >> /tmp/autostart.log 2>&1
  else
    npx --yes pm2 restart bore-tunnel >> /tmp/autostart.log 2>&1
  fi
fi
) 9>$LOCK
SH
chmod +x $HOME/.bashrc.d/99-autostart.sh
ls -la $HOME/.bashrc.d/

echo "[5] PM2 重启 chatroom-app 让 public/index.html（ChatRoom App 首页模板）生效（bore/redis 不动！）"
PM2CMD=""
for p in ./node_modules/.bin/pm2 /usr/local/share/npm-global/bin/pm2; do [ -x "$p" ] && PM2CMD="$p" && break; done
[ -z "$PM2CMD" ] && PM2CMD="npx --yes pm2"
# 只重启 chatroom-app
$PM2CMD restart chatroom-app 2>&1 | tail -5
sleep 8
echo "  PM2 status:"
$PM2CMD status 2>&1 | sed -n '1,15p'
$PM2CMD save 2>&1 | tail -2

echo "[6] 服务 / bore 就绪检查（循环最多 10 次）"
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  HC=$(curl -sS --max-time 3 -o /tmp/h.out -w "%{http_code}" http://127.0.0.1:3001/api/health 2>/dev/null || echo 000)
  BPID=$(pgrep -x bore || echo none)
  R3001=$(curl -sS --max-time 3 http://127.0.0.1:3001/ 2>/dev/null | wc -c)
  TITLE=$(curl -sS --max-time 3 http://127.0.0.1:3001/ 2>/dev/null | grep -oE "<title>[^<]*</title>" || echo "")
  echo "  try=$i health HTTP=$HC bore=$BPID index.size=$R3001 $TITLE"
  if [ "$HC" = "200" ] && [ "$BPID" != "none" ] && [ "$R3001" -gt 1500 ]; then break; fi
done
echo "  本地 3001 / 首页 title:"
curl -sS --max-time 4 http://127.0.0.1:3001/ 2>/dev/null | grep -oE "<title>[^<]*</title>" || echo "(空)"
cat /tmp/h.out 2>/dev/null; echo

echo "[DONE] branch=$(git branch --show-current) commit=$(git rev-parse HEAD)"
