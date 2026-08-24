/**
 * 部署到 Vercel Edge Functions：作为 Codespace 唤醒入口
 *
 * 功能：
 *  - 固定 URL：部署后得到 https://<project>.vercel.app
 *  - 用户访问 → 后台异步调 GitHub API 启动 Codespace → 返回等待页（3秒自动刷新）
 *  - 若 Codespace 已运行 → 302 跳转到公开 URL
 *
 * 部署步骤：
 *  1. 去 https://vercel.com/signup 用 GitHub 一键登录，基本没人机验证
 *  2. 新建项目 → Empty Project
 *  3. 新建 api/ 目录，把本文件保存为 api/wake.ts
 *  4. 在 Vercel Project Settings → Environment Variables 添加：
 *       GH_PAT            = 你那个带 codespace 权限的 PAT
 *       GH_OWNER          = yaoyao5296
 *       GH_REPO           = chatroom
 *       CODESPACE_NAME    = chatroom-qvqrr4p54q7jh46r6
 *       DEFAULT_PUBLIC_URL= https://chatroom-qvqrr4p54q7jh46r6-3001.app.github.dev
 *  5. Deploy
 *
 * 另可把首页也配置成一样：把本文件另存为 api/index.ts
 */
export const config = { runtime: 'edge' }

const GH_HEADERS = (token: string) => ({
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

type CSState = 'Unknown'|'Created'|'Queued'|'Provisioning'|'Available'|'Starting'|'ShuttingDown'|'Stopped'|'Failed'|'Exporting'|'Updating'

async function getCS(env: { GH_PAT: string; CODESPACE_NAME: string }) {
  try {
    const r = await fetch(
      `https://api.github.com/user/codespaces/${encodeURIComponent(env.CODESPACE_NAME)}`,
      { headers: GH_HEADERS(env.GH_PAT), signal: AbortSignal.timeout(10000) }
    )
    if (!r.ok) return { state: 'Unknown' as CSState, url: '' }
    const j = await r.json()
    return { state: j.state as CSState, url: j.web_url || '' }
  } catch { return { state: 'Unknown' as CSState, url: '' } }
}

async function startCS(env: { GH_PAT: string; CODESPACE_NAME: string }) {
  try {
    await fetch(
      `https://api.github.com/user/codespaces/${encodeURIComponent(env.CODESPACE_NAME)}/start`,
      { method: 'POST', headers: GH_HEADERS(env.GH_PAT), signal: AbortSignal.timeout(12000) }
    )
  } catch {}
}

function waitingPage(retrySec: number) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="${retrySec}; url=/">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>服务准备中 · ChatRoom</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0f;color:#E2E8F0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
.card{text-align:center;max-width:420px;padding:30px}
.spin{width:48px;height:48px;border:4px solid rgba(56,189,248,.2);border-top-color:#38BDF8;border-radius:50%;animation:r 1s linear infinite;margin:0 auto 24px}
@keyframes r{to{transform:rotate(360deg)}}
h1{font-size:22px;margin:0 0 10px;background:linear-gradient(135deg,#38BDF8,#818CF8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p{color:#94A3B8;font-size:14px;line-height:1.8;margin:0}
</style></head><body>
<div class="card">
<div class="spin"></div>
<h1>服务准备中</h1>
<p>Codespace 正在启动，${retrySec} 秒后自动刷新…<br>首次启动约需 30~60 秒。</p>
</div></body></html>`
}

export default async function handler(req: Request) {
  const url = new URL(req.url)

  // 健康检查
  if (url.pathname === '/api/health' || url.pathname === '/__health') {
    return new Response(JSON.stringify({ ok: true, t: Date.now() }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const env = {
    GH_PAT:            process.env.GH_PAT || '',
    GH_OWNER:          process.env.GH_OWNER || '',
    GH_REPO:           process.env.GH_REPO || '',
    CODESPACE_NAME:    process.env.CODESPACE_NAME || '',
    DEFAULT_PUBLIC_URL:process.env.DEFAULT_PUBLIC_URL || '',
  }

  const { state } = await getCS(env)

  if (state === 'Available') {
    const target = env.DEFAULT_PUBLIC_URL
    if (target) return Response.redirect(target, 302)
  }

  // 其他状态（Stopped/Starting/Queued/ShuttingDown/Unknown/Provisioning/Updating/Exporting）
  // 都异步触发 start（GitHub 幂等，正在启动的也能安全重复调用）
  if (state === 'Stopped' || state === 'ShuttingDown' || state === 'Unknown'
      || state === 'Queued' || state === 'Provisioning' || state === 'Starting'
      || state === 'Updating' || state === 'Exporting' || state === 'Created') {
    const ctx = (globalThis as any).EdgeRuntime
    if (ctx?.waitUntil) {
      ctx.waitUntil(startCS(env))
    } else {
      // 兜底：fire-and-forget
      startCS(env).catch(() => {})
    }
  }

  return new Response(waitingPage(3), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
