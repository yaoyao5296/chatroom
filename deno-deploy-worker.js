/**
 * 部署到 Deno Deploy：Codespace 唤醒入口
 *
 * 优点：
 *   - 注册 30 秒（邮箱或 GitHub），基本没人机验证
 *   - 免费无限次请求（限带宽，够用）
 *   - 部署最简单：打开 https://dash.deno.com/new_playground 粘贴代码 → 点 Deploy
 *
 * 部署步骤：
 *   1. 打开 https://dash.deno.com 用 GitHub 登录
 *   2. "New Playground" → 清空编辑器，粘贴本文件全部内容
 *   3. 打开项目 Settings → Environment Variables 添加：
 *        GH_PAT            = 你的 PAT（带 codespace 权限）
 *        CODESPACE_NAME    = chatroom-qvqrr4p54q7jh46r6
 *        DEFAULT_PUBLIC_URL= https://chatroom-qvqrr4p54q7jh46r6-3001.app.github.dev
 *   4. Save & Deploy → 得到固定域名：https://<随机>.deno.dev，分享给用户即可
 */
const GH_HEADERS = (token) => ({
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
})

async function getCS({ GH_PAT, CODESPACE_NAME }) {
  try {
    const r = await fetch(
      `https://api.github.com/user/codespaces/${encodeURIComponent(CODESPACE_NAME)}`,
      { headers: GH_HEADERS(GH_PAT) },
    )
    if (!r.ok) return { state: 'Unknown' }
    const j = await r.json()
    return { state: j.state || 'Unknown' }
  } catch { return { state: 'Unknown' } }
}

async function startCS({ GH_PAT, CODESPACE_NAME }) {
  try {
    await fetch(
      `https://api.github.com/user/codespaces/${encodeURIComponent(CODESPACE_NAME)}/start`,
      { method: 'POST', headers: GH_HEADERS(GH_PAT) },
    )
  } catch {}
}

function waitingPage(sec) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="${sec}; url=/">
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
<p>Codespace 正在启动，${sec} 秒后自动刷新…<br>首次启动约需 30~60 秒。</p>
</div></body></html>`
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (url.pathname === '/api/health' || url.pathname === '/__health') {
    return new Response(JSON.stringify({ ok: true, t: Date.now() }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const env = {
    GH_PAT:             Deno.env.get('GH_PAT') || '',
    CODESPACE_NAME:     Deno.env.get('CODESPACE_NAME') || '',
    DEFAULT_PUBLIC_URL: Deno.env.get('DEFAULT_PUBLIC_URL') || '',
  }

  const { state } = await getCS(env)
  if (state === 'Available' && env.DEFAULT_PUBLIC_URL) {
    return Response.redirect(env.DEFAULT_PUBLIC_URL, 302)
  }

  // 非 Available 状态 → 异步 start + 等待页
  startCS(env)
  return new Response(waitingPage(3), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
})
