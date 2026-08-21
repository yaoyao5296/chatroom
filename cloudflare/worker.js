/**
 * Cloudflare Worker —— Codespace 自动启停 + 异步唤醒入口
 *
 * 用户访问流程（用户视角）：
 *  1. 访问 https://chatroom.<your-subdomain>.workers.dev（固定入口）
 *  2. 若 Codespace 已运行 → 立即 302 跳转到 Codespace 公开 URL
 *  3. 若 Codespace 未运行 → 返回"服务准备中"等待页，浏览器自动每 3 秒刷新
 *     Worker 后台异步调用 GitHub API start Codespace
 *  4. 用户刷新 N 次后，Codespace 就绪 → 跳转
 *
 * 关键设计：
 *  - 入口 URL 永久固定（Worker 域名）
 *  - 跳转目标 = Codespace 公开 URL（重启不变），优先读仓库 .codespace-url 文件
 *  - 状态缓存到 KV，避免每个请求都调 GitHub API（5 秒缓存）
 *  - start 操作幂等：GitHub API 对已 running 的 codespace 调 start 会返回当前状态
 */

// ============ 配置（在 wrangler.toml 里通过 vars 注入） ============
// 这些值在部署时配置，下方有默认值仅用于本地开发
const CONFIG = {
  // GitHub 仓库信息（owner/repo）
  GH_OWNER: '',          // 例：'yaoyao5296'
  GH_REPO: '',           // 例：'chatroom'
  GH_BRANCH: 'master',   // 仓库分支
  // GitHub PAT（需要 codespace 权限）
  GH_PAT: '',
  // Codespace 名称（GitHub Codespaces 自动生成的 name，不是显示名）
  CODESPACE_NAME: '',
  // 状态缓存秒数
  STATUS_CACHE_TTL: 5,
  // 默认 Codespace 公开 URL（兜底，如果仓库文件读不到）
  // 格式：https://<codespace-name>-3001.app.github.dev
  DEFAULT_PUBLIC_URL: '',
}

// ============ 工具：GitHub API 调用 ============
function ghHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cloudflare-worker-codespace-proxy',
  }
}

// 查询 Codespace 状态
// 返回: { status, url }  status ∈ 'Unknown'|'Created'|'Queued'|'Provisioning'|'Available'|'Starting'|'ShuttingDown'|'Stopped'|'Failed'|'Exporting'|'Updating'
async function getCodespaceStatus(env) {
  const name = env.CODESPACE_NAME
  const token = env.GH_PAT
  if (!name || !token) {
    return { status: 'Unknown', url: '' }
  }
  // 先读 KV 缓存
  const cacheKey = `codespace-status:${name}`
  const cached = await env.CHATROOM_KV?.get(cacheKey)
  if (cached) {
    try {
      const obj = JSON.parse(cached)
      // 5 秒内的缓存直接用
      if (Date.now() - obj.ts < CONFIG.STATUS_CACHE_TTL * 1000) {
        return obj.data
      }
    } catch {}
  }

  const url = `https://api.github.com/user/codespaces/${encodeURIComponent(name)}`
  try {
    const res = await fetch(url, { headers: ghHeaders(token), signal: AbortSignal.timeout(8000) })
    if (!res.ok) {
      return { status: 'Unknown', url: '' }
    }
    const data = await res.json()
    const result = { status: data.state || 'Unknown', url: '' }
    // 写缓存
    try {
      await env.CHATROOM_KV?.put(cacheKey, JSON.stringify({ ts: Date.now(), data: result }), { expirationTtl: 30 })
    } catch {}
    return result
  } catch (err) {
    return { status: 'Unknown', url: '' }
  }
}

// 触发启动 Codespace（幂等，已 running 不会出错）
async function startCodespace(env) {
  const name = env.CODESPACE_NAME
  const token = env.GH_PAT
  if (!name || !token) return { ok: false, status: 'Unknown' }
  const url = `https://api.github.com/user/codespaces/${encodeURIComponent(name)}/start`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: ghHeaders(token),
      signal: AbortSignal.timeout(15000),
    })
    // 202 = 已接受，启动中；200 = 已 running；409 = 已在运行
    if (res.status === 202 || res.status === 200 || res.status === 409) {
      // 启动后立即把缓存置为 Starting，避免短时间内重复触发
      try {
        await env.CHATROOM_KV?.put(
          `codespace-status:${name}`,
          JSON.stringify({ ts: Date.now(), data: { status: 'Starting', url: '' } }),
          { expirationTtl: 10 },
        )
      } catch {}
      return { ok: true, status: 'Starting' }
    }
    return { ok: false, status: 'Unknown' }
  } catch (err) {
    return { ok: false, status: 'Unknown' }
  }
}

// 从仓库读取 .codespace-url 文件（bootstrap 脚本上报的最新公开 URL）
async function getPublicUrlFromRepo(env) {
  if (!env.GH_OWNER || !env.GH_REPO || !env.GH_PAT) return ''
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/.codespace-url`
  try {
    const res = await fetch(url, {
      headers: ghHeaders(env.GH_PAT),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return ''
    const data = await res.json()
    if (!data.content) return ''
    // base64 解码内容
    const content = atob(data.content.replace(/\n/g, '')).trim()
    return content || ''
  } catch {
    return ''
  }
}

// ============ 等待页 HTML ============
function waitingPageHtml(retrySeconds = 3) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChatRoom · 服务启动中</title>
<meta http-equiv="refresh" content="${retrySeconds}">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    color: #fff;
  }
  .card {
    background: rgba(255,255,255,0.1); backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.2); border-radius: 24px;
    padding: 48px 40px; text-align: center; max-width: 90vw; width: 420px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  }
  .spinner {
    width: 56px; height: 56px; border: 4px solid rgba(255,255,255,0.2);
    border-top-color: #fff; border-radius: 50%;
    margin: 0 auto 24px; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 22px; font-weight: 600; margin-bottom: 12px; }
  p { font-size: 14px; opacity: 0.9; line-height: 1.6; margin-bottom: 4px; }
  .small { font-size: 12px; opacity: 0.6; margin-top: 16px; }
  .dot { display: inline-block; animation: blink 1.4s infinite; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }
</style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>服务正在唤醒</h1>
    <p>ChatRoom 正在从休眠中启动<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></p>
    <p>页面将在 ${retrySeconds} 秒后自动跳转</p>
    <p class="small">首次启动约需 30-60 秒，请稍候</p>
  </div>
</body>
</html>`
}

// ============ 主入口 ============
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // 健康检查端点（给监控用）
    if (url.pathname === '/__health' || url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, time: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 合并配置：env（wrangler.toml 注入）> 默认值
    const E = {
      GH_OWNER: env.GH_OWNER || CONFIG.GH_OWNER,
      GH_REPO: env.GH_REPO || CONFIG.GH_REPO,
      GH_BRANCH: env.GH_BRANCH || CONFIG.GH_BRANCH,
      GH_PAT: env.GH_PAT || CONFIG.GH_PAT,
      CODESPACE_NAME: env.CODESPACE_NAME || CONFIG.CODESPACE_NAME,
      DEFAULT_PUBLIC_URL: env.DEFAULT_PUBLIC_URL || CONFIG.DEFAULT_PUBLIC_URL,
    }

    // 查询 Codespace 状态
    const { status } = await getCodespaceStatus(E)

    // 已运行 → 跳转
    if (status === 'Available') {
      // 优先读仓库上报的最新 URL，兜底用默认 URL
      let target = E.DEFAULT_PUBLIC_URL
      const repoUrl = await getPublicUrlFromRepo(E).catch(() => '')
      if (repoUrl) target = repoUrl
      if (!target) {
        // 没有目标 URL，返回等待页（罕见，初次配置时可能发生）
        return new Response(waitingPageHtml(5), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        })
      }
      return Response.redirect(target, 302)
    }

    // 未运行或正在停止 → 异步触发启动，返回等待页
    // Available 之外的状态都需要触发启动：Stopped / ShuttingDown / Unknown 都尝试 start（幂等）
    if (status === 'Stopped' || status === 'ShuttingDown' || status === 'Unknown' || status === 'Queued' || status === 'Provisioning' || status === 'Starting') {
      // 异步触发，不阻塞响应（waitUntil 保证 Worker 返回后仍会执行）
      ctx.waitUntil(startCodespace(E))
    }

    return new Response(waitingPageHtml(3), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  },
}
