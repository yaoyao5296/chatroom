#!/bin/bash
# 自动推送脚本 — 每小时将 /opt/chatroom 代码推送到 GitHub
cd /opt/chatroom

# 读取 token
TOKEN=$(grep GITHUB_TOKEN /opt/chatroom/.env 2>/dev/null | cut -d= -f2)
if [ -z "$TOKEN" ]; then
  echo "[auto-push] $(date): 未找到 GITHUB_TOKEN，跳过"
  exit 0
fi

# 设置带 token 的 remote
git remote set-url origin "https://${TOKEN}@github.com/yaoyao5296/chatroom.git" 2>/dev/null

# 检查是否有变更
if git diff --quiet && git diff --cached --quiet; then
  echo "[auto-push] $(date): 无变更，跳过"
  exit 0
fi

git add -A
git commit -m "auto: 定时备份 $(date +"%Y-%m-%d %H:%M")"
git push origin master

# 恢复无 token 的 remote（避免泄露）
git remote set-url origin https://github.com/yaoyao5296/chatroom.git

echo "[auto-push] $(date): 推送完成"