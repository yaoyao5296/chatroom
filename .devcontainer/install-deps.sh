#!/usr/bin/env bash
# 仅在 Codespace 首次创建时运行 —— 复用 package-lock.json 锁定的依赖版本，
# 让 Codespace 预构建镜像能直接命中 node_modules 缓存，跳过安装步骤。
set -euo pipefail

# PATH 修复（非交互式 shell 不加载 nvm）
for p in /home/codespace/nvm/current/bin /usr/local/nodejs/current/bin /usr/local/bin; do
  [ -d "$p" ] && case ":$PATH:" in *":$p:"*) ;; *) PATH="$p:$PATH" ;; esac
done
export PATH
export NVM_DIR="${NVM_DIR:-/home/codespace/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true

cd /workspaces/chatroom 2>/dev/null || cd "${CODESPACE_VSCODE_FOLDER:-/workspace}" 2>/dev/null || cd /workspace 2>/dev/null

echo "[install] Node $(node -v) / npm $(npm -v)"

# 关键：用 npm ci 严格按 package-lock.json 安装，确保跨机器复现一致
# --no-audit --no-fund 跳过审计和赞助请求，节省 30-60 秒
# --omit=dev 在 Codespace 预构建阶段不装 devDependencies（后续构建时再补）
if [ -f package-lock.json ]; then
  echo "[install] 使用 npm ci 复用 package-lock.json"
  npm ci --no-audit --no-fund --omit=dev || {
    echo "[install] npm ci 失败，回退到 npm install"
    npm install --no-audit --no-fund --omit=dev
  }
else
  echo "[install] 未找到 package-lock.json，生成并安装"
  npm install --no-audit --no-fund --omit=dev
fi

# 构建前端产物 —— 这样预构建镜像里就已经带 dist，启动时直接复用
echo "[install] 构建前端产物（vite build）"
if [ ! -d dist ] || [ ! -f dist/index.html ]; then
  npx vite build || echo "[install] vite build 失败，bootstrap 时再试"
fi

# 创建必要目录
mkdir -p data uploads logs .redis-data

# 预装 gh CLI（用于 bootstrap.sh 设置端口可见性）和 redis-server
echo "[install] 预装 gh CLI 和 Redis"
if ! command -v gh >/dev/null 2>&1; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null || true
  sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null || true
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null 2>&1 || true
fi
# 一次性装 gh + redis（bootstrap.sh 每次启动都需要这两个）
sudo apt-get update -qq 2>/dev/null
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y gh redis-server redis-tools >/dev/null 2>&1 || true
echo "[install] gh=$(gh --version 2>/dev/null | head -1)  redis=$(redis-server --version 2>/dev/null | head -1)"

echo "[install] 完成"
