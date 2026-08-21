# Codespace 自动启停方案

把 ChatRoom 部署到 GitHub Codespace，配合 Cloudflare Worker 实现：
- **固定入口**：用户访问 `https://chatroom-codespace-proxy.<你的子域>.workers.dev`，永久不变
- **按需唤醒**：Codespace 停止时不计费，有用户访问 Worker 才异步启动
- **空闲自停**：10 分钟无真实用户访问自动停止 Codespace，省免费时长
- **无感启动**：用户访问时先看到"服务启动中"等待页，自动刷新，ready 后跳转

## 架构

```
用户 → Cloudflare Worker (固定入口)
         │
         ├─ Codespace 状态 = Available → 302 跳转到 Codespace 公开 URL
         │
         └─ Codespace 状态 = Stopped/Unknown
              ├─ 异步调 GitHub API start Codespace
              └─ 返回"服务启动中"等待页（每 3 秒自动刷新）

Codespace 内:
  bootstrap.sh → 启动服务 + 上报公开 URL 到 .codespace-url + 拉起空闲守护
  idleTracker 中间件 → 只统计真实用户访问到 ./data/last-access.json
  codespace-idle-watcher.mjs → 每 60s 检查，10 分钟无访问则 stop Codespace
```

## 部署步骤

### 1. 推送代码到 GitHub

```bash
git add .devcontainer/ api/middleware/idleTracker.ts api/app.ts \
        scripts/codespace-idle-watcher.mjs cloudflare/ .codespace-url
git commit -m "feat: codespace auto start/stop with cloudflare worker"
git push origin master
```

### 2. 创建 Codespace

在 GitHub 仓库页面点 `Code` → `Codespaces` → `Create codespace on master`。
首次创建会执行 `.devcontainer/install-deps.sh`，复用 `package-lock.json` 安装依赖并构建 dist。

### 3. 获取 Codespace 名称和公开 URL

在 Codespace 终端运行：

```bash
# 获取 Codespace 名称
echo $CODESPACE_NAME

# 获取端口 3001 的公开 URL（确保已 public）
gh codespace ports
```

把 `CODESPACE_NAME` 和 `DEFAULT_PUBLIC_URL` 填到 `cloudflare/wrangler.toml`。

### 4. 创建 GitHub PAT

到 https://github.com/settings/tokens 生成 classic token，勾选 `codespace` 权限（或 fine-grained token 勾 Codespaces 读写）。

把 PAT 作为 Codespace Secret 注入（这样 idle-watcher 才能停止 Codespace）：

```bash
# 在 Codespace 终端运行
gh secret set GH_PAT --codespace -b "你的PAT值"
```

### 5. 部署 Cloudflare Worker

```bash
cd cloudflare/

# 安装 wrangler（如果没有）
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建 KV 命名空间
npx wrangler kv namespace create CHATROOM_KV
# 把返回的 id 填到 wrangler.toml 的 [[kv_namespaces]] id 字段

# 设置敏感变量
npx wrangler secret put GH_PAT
# 粘贴 PAT 值

# 部署
npx wrangler deploy
```

部署后会输出固定入口 URL，例如：
`https://chatroom-codespace-proxy.your-name.workers.dev`

把这个地址分享给用户即可。

### 6. 验证

- 访问 Worker URL：应看到"服务启动中"等待页（如果 Codespace 已停）
- 等待 30-60 秒：自动跳转到 Codespace 公开 URL
- 再次访问 Worker URL：应立即跳转（Codespace 已运行）
- 停止 Codespace（在 GitHub UI 或 `gh codespace stop`）后访问 Worker URL：应再次触发唤醒流程

## 文件说明

| 文件 | 作用 |
|------|------|
| `.devcontainer/devcontainer.json` | Codespace 镜像配置（Node 20 + Redis + 端口 3001 公开） |
| `.devcontainer/install-deps.sh` | 首次创建时复用 package-lock 安装依赖 + 构建 dist |
| `.devcontainer/bootstrap.sh` | 每次启动时构建 + 起服务 + 上报 URL + 拉起守护 |
| `api/middleware/idleTracker.ts` | 过滤无效请求，只记录真实访问到 `./data/last-access.json` |
| `scripts/codespace-idle-watcher.mjs` | 10 分钟无访问则调 GitHub API stop Codespace |
| `cloudflare/worker.js` | Worker 入口，检查状态 + 异步唤醒 + 跳转 |
| `cloudflare/wrangler.toml` | Worker 部署配置 |

## 调参

| 环境变量 | 默认 | 说明 |
|---------|------|------|
| `IDLE_THRESHOLD_MIN` | 10 | 空闲多少分钟后停止 Codespace |
| `STATUS_CACHE_TTL` | 5 | Worker 状态缓存秒数 |

在 Codespace Secrets 或 `.env` 里调整。

## 注意事项

- **Codespace 免费额度**：GitHub Free 计划每月 120 core-hours（2 核 = 60 小时）。停止状态不计费。
- **PAT 权限**：必须包含 `codespace` 权限才能 stop/start。
- **首次启动较慢**：约 30-60 秒（拉镜像 + 启动 + 建立端口转发）。后续因为依赖已预构建缓存，会更快。
- **公开 URL 不变性**：只要不删除重建 Codespace，`<name>-3001.app.github.dev` 重启后不变。`.codespace-url` 文件是双保险。
