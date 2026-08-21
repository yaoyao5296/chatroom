/**
 * Vercel Edge Function: Codespace 唤醒 + 跳转入口
 *
 * 部署后访问 https://<project>.vercel.app/ → 命中本 handler
 * 逻辑：
 *   Codespace Available  → 302 跳转到公开 URL
 *   其他状态            → 异步 start + 返回等待页（3 秒自动刷新）
 */
export const config = { runtime: 'edge' }

const REPO = {
  OWNER: process.env.GH_OWNER || 'yaoyao5296',
  NAME:  process.env.GH_REPO  || 'chatroom',
}
const CODESPACE_NAME = process.env.CODESPACE_NAME || ''
const DEFAULT_PUBLIC_URL = process.env.DEFAULT_PUBLIC_URL || ''

const GH_H = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

type State = 'Unknown'|'Available'|'Starting'|'Queued'|'Provisioning'|'Stopped'|'ShuttingDown'|'Failed'|'Exporting'|'Updating'|'Created'

async function getState(pat: string): Promise<State> {
  try {
    const r = await fetch(
      `https://api.github.com/user/codespaces/${encodeURIComponent(CODESPACE_NAME)}`,
      { headers: GH_H(pat), signal: AbortSignal.timeout(10000) }
    )
    if (!r.ok) return 'Unknown'
    return ((await r.json()) as { state?: State }).state || 'Unknown'
  } catch { return 'Unknown' }
}

async function startCS(pat: string) {
  try {
    await fetch(
      `https://api.github.com/user/codespaces/${encodeURIComponent(CODESPACE_NAME)}/start`,
      { method: 'POST', headers: GH_H(pat), signal: AbortSignal.timeout(12000) }
    )
  } catch {}
}

function page(sec: number, tip?: string) {
  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="${sec}; url=/">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>服务准备中 · ChatRoom</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:#0a0a0f;color:#E2E8F0;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{text-align:center;max-width:420px;padding:32px 24px}
.spin{width:52px;height:52px;border:4px solid rgba(56,189,248,.18);border-top-color:#38BDF8;
  border-radius:50%;animation:r 1s linear infinite;margin:0 auto 24px}
@keyframes r{to{transform:rotate(360deg)}}
.brand{font-size:28px;font-weight:800;margin:0 0 10px;
  background:linear-gradient(135deg,#38BDF8 0%,#818CF8 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.sub{color:#94A3B8;font-size:14px;line-height:1.9;margin:0}
.tip{margin-top:18px;color:#64748B;font-size:12px}
</style></head><body>
<div class="wrap">
<div class="spin"></div>
<h1 class="brand">ChatRoom</h1>
<p class="sub">
  Codespace 正在启动，${sec} 秒后自动刷新…<br>
  首次启动约需 30~60 秒，请稍候。
</p>
${tip ? `<p class="tip">${tip}</p>` : ''}
</div></body></html>`
}

export default async function handler(req: Request, ctx: any) {
  const url = new URL(req.url)

  if (url.pathname === '/api/health' || url.pathname === '/__health') {
    return new Response(JSON.stringify({ ok: true, t: Date.now() }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const PAT = process.env.GH_PAT || ''

  // 未配置 PAT 或 CS_NAME → 直接跳转到默认公开 URL（若有）
  if (!PAT || !CODESPACE_NAME) {
    if (DEFAULT_PUBLIC_URL) return Response.redirect(DEFAULT_PUBLIC_URL, 302)
    return new Response(page(5, '⚠ 未配置 GH_PAT / CODESPACE_NAME，请先在 Vercel 环境变量里设置'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      status: 500,
    })
  }

  const state = await getState(PAT)

  if (state === 'Available') {
    const target = DEFAULT_PUBLIC_URL
    if (target) return Response.redirect(target, 302)
    return new Response(page(3, '⚠ 未配置 DEFAULT_PUBLIC_URL'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  // 非 Available：异步触发 start + 返回等待页
  if (ctx?.waitUntil) ctx.waitUntil(startCS(PAT))
  else startCS(PAT).catch(() => {})

  const tip = state === 'Queued' || state === 'Provisioning'
    ? '状态：首次创建/分配资源中（可能稍久）'
    : state === 'Starting'
      ? '状态：启动中…'
      : state === 'Stopped'
        ? '状态：已停止，正在唤醒…'
        : `状态：${state}`
  return new Response(page(3, tip), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
