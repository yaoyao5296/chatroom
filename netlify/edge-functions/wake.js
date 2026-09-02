// Netlify Edge Function：Codespace 唤醒服务
// 永久免费，部署后自带域名 <site>.netlify.app
//
// 环境变量（在 Netlify Dashboard → Site settings → Environment variables 设置）：
//   GH_PAT          = GitHub PAT（含 codespace 权限）
//   CODESPACE_NAME  = chatroom-qvqrr4p54q7jh46r6
//   BORE_URL        = http://bore.pub:31425
//   ALIYUN_URL      = http://8.163.56.203/  （备用稳定入口）
//
// 注：GH_PAT 为高敏感凭据，必须在 Netlify Dashboard 后台设置环境变量，
//     不能写死到 DEFAULTS 里提交到代码仓库。未设置时返回 500 提示。
const DEFAULTS = {
  CODESPACE_NAME: 'chatroom-qvqrr4p54q7jh46r6',
  BORE_URL:       'http://bore.pub:31425',
  ALIYUN_URL:     'http://8.163.56.203/',
};

function env(key) {
  try {
    // Netlify Edge Functions 原生环境变量访问
    const v = Netlify.env.get(key);
    if (v) return v;
  } catch {}
  return DEFAULTS[key] || '';
}

const GH_PAT         = env('GH_PAT');
const CODESPACE_NAME = env('CODESPACE_NAME');
const BORE_URL       = env('BORE_URL');
const ALIYUN_URL     = env('ALIYUN_URL');

function ghHeaders() {
  return {
    'Authorization':        `Bearer ${GH_PAT}`,
    'Accept':               'application/vnd.github+json',
    'User-Agent':           'chatroom-wake-netlify/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function getCS() {
  try {
    const r = await fetch(
      `https://api.github.com/user/codespaces/${encodeURIComponent(CODESPACE_NAME)}`,
      { headers: ghHeaders() },
    );
    if (!r.ok) return { state: 'Unknown' };
    const j = await r.json();
    return { state: j.state || 'Unknown' };
  } catch {
    return { state: 'Unknown' };
  }
}

async function startCS() {
  try {
    await fetch(
      `https://api.github.com/user/codespaces/${encodeURIComponent(CODESPACE_NAME)}/start`,
      { method: 'POST', headers: ghHeaders() },
    );
  } catch {}
}

const STATE_TEXT = {
  Available:    '✅ 服务就绪，正在检测 Bore 隧道…',
  Queued:       '⏳ 资源排队中…',
  Provisioning: '🔧 机器分配中…',
  Starting:     '🚀 Codespace 启动中…',
  Rebuilding:   '🔄 正在重建环境…',
  Stopping:     '🛑 上一次还在关闭中…',
  Stopped:      '💤 Codespace 刚刚被唤醒，请稍候…',
  Unknown:      '🔎 正在查询状态…',
};

function html(state) {
  const tip = STATE_TEXT[state] || `⏳ 状态：${state}`;
  const readyCls = state === 'Available';
  // 初始预计等待秒数：Available=3 跳转；其它状态按 90 秒倒计时
  const initSec = readyCls ? 3 : 90;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${readyCls?'服务已就绪 · 跳转中':'服务启动中 · ChatRoom'}</title>
<style>
:root{--fg:#E2E8F0;--muted:#94A3B8;--card:#12121a;--accent:#38BDF8;--accent2:#818CF8;--warn:#FBBF24}
*{box-sizing:border-box}
html,body{margin:0;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:linear-gradient(160deg,#06060a 0%,#0e0e18 60%,#111126 100%);color:var(--fg)}
body{display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:100%;max-width:460px;background:rgba(18,18,26,.85);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:36px 28px;box-shadow:0 40px 100px rgba(0,0,0,.5)}
.spin{width:64px;height:64px;border:5px solid rgba(56,189,248,.15);border-top-color:var(--accent);border-radius:50%;animation:r .9s linear infinite;margin:0 auto 26px}
@keyframes r{to{transform:rotate(360deg)}}
.check{width:64px;height:64px;background:linear-gradient(135deg,#4ADE80,#22D3EE);border-radius:50%;margin:0 auto 26px;display:flex;align-items:center;justify-content:center;color:#062e1a;font-size:34px;font-weight:800}
.big-title{font-size:30px;font-weight:700;text-align:center;margin:0 0 6px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:1px}
.sub{color:var(--muted);font-size:15px;line-height:1.8;text-align:center;margin:0}
.countdown{margin:22px auto 0;display:flex;align-items:baseline;justify-content:center;gap:8px}
.countdown .num{font-size:56px;font-weight:800;line-height:1;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-family:ui-monospace,Menlo,Consolas,monospace;min-width:2ch;text-align:center}
.countdown .unit{font-size:18px;color:var(--muted);font-weight:500}
.eta-tip{text-align:center;margin-top:10px;font-size:13px;color:var(--muted)}
.pill{display:inline-block;padding:7px 14px;border-radius:999px;background:rgba(56,189,248,.1);color:var(--accent);font-size:13px;margin-top:18px;font-weight:500}
.meta{margin-top:24px;padding:16px 18px;border-radius:14px;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.18);color:var(--warn);font-size:13px;line-height:1.8}
.meta a{color:var(--warn);font-weight:600;text-decoration:underline}
.btns{display:flex;flex-direction:column;gap:10px;margin-top:20px}
.btn{display:block;text-align:center;padding:14px 16px;border-radius:14px;font-size:15px;font-weight:600;text-decoration:none;transition:transform .15s ease}
.btn:active{transform:scale(.98)}
.btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#0b1220;box-shadow:0 8px 24px rgba(56,189,248,.25)}
.btn-ghost{background:rgba(255,255,255,.05);color:var(--fg);border:1px solid rgba(255,255,255,.1)}
.bar{height:8px;border-radius:999px;background:rgba(255,255,255,.05);overflow:hidden;margin-top:22px}
.bar>div{height:100%;width:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));transform-origin:left;transition:transform 1s linear}
.info{margin-top:22px;font-size:12px;color:var(--muted);text-align:center;line-height:1.9}
.kbd{font-family:ui-monospace,monospace;font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);margin:0 2px}
</style></head><body><div class="card">
<div id="icon" class="${readyCls?'check':'spin'}">${readyCls?'✓':''}</div>
<h1 class="big-title" id="t">${readyCls?'服务已就绪':'🚀 服务启动中'}</h1>
<p class="sub" id="tip">${tip}</p>

<div class="countdown" id="cd" style="${readyCls?'display:none':''}">
  <span class="num" id="secNum">${initSec}</span>
  <span class="unit">秒</span>
</div>
<p class="eta-tip" id="etaTip" style="${readyCls?'display:none':''}">预计还需等待 · 首次唤醒约 60–120 秒</p>

<p style="text-align:center"><span class="pill" id="pill">当前状态：${state}</span></p>

<div class="bar" id="bar" style="${readyCls?'display:none':''}"><div id="barFill" style="transform:scaleX(1)"></div></div>

<div class="meta">🔥 不想等？阿里云 24h 在线稳定入口，点下面按钮直接返回首页使用：
<div style="margin-top:10px"><a href="${ALIYUN_URL}" target="_blank">${ALIYUN_URL}</a></div></div>

<div class="btns">
<a id="jump" class="btn btn-primary" href="${BORE_URL}" style="${readyCls?'':'display:none'}">立即进入 ChatRoom（Bore 节点）→</a>
<a class="btn btn-ghost" href="${ALIYUN_URL}">💡 改用阿里云稳定版</a>
</div>

<div class="info">页面每 <span class="kbd">3</span> 秒自动查询一次状态，Codespace 启动完成后会自动跳转。<br>
若倒计时结束仍未就绪，页面会继续等待并刷新预计时间。</div>
</div>
<script>
(function(){
  var B=${JSON.stringify(BORE_URL)};
  var T=${JSON.stringify(STATE_TEXT)};
  var t=document.getElementById('t'),tip=document.getElementById('tip'),pill=document.getElementById('pill');
  var icon=document.getElementById('icon'),bar=document.getElementById('bar'),barFill=document.getElementById('barFill');
  var jump=document.getElementById('jump'),cd=document.getElementById('cd'),secNum=document.getElementById('secNum'),etaTip=document.getElementById('etaTip');
  var INIT_SEC=${initSec};
  var remain=Math.max(3,INIT_SEC);
  var startTs=Date.now();
  var tm,cdTm,go=false,started=false;

  function tickCD(){
    remain=Math.max(0,remain-1);
    secNum.textContent=remain;
    if(barFill){
      var p=INIT_SEC>0?Math.max(0,Math.min(1,remain/INIT_SEC)):0;
      barFill.style.transform='scaleX('+p+')';
    }
    if(remain<=0){
      // 到 0 了但还没好？续 45 秒（Codespace 有时排队稍长）
      remain=45;INIT_SEC=remain;
      etaTip.textContent='还需要再等一下 · 资源调度中';
    }
  }
  cdTm=setInterval(tickCD,1000);

  var boreReady=false;

  // 探测 Bore 隧道是否可达
  async function probeBore(){
    try{
      var r=await fetch(B,{mode:'no-cors',cache:'no-store'});
      boreReady=true;
      return true;
    }catch(e){
      boreReady=false;
      return false;
    }
  }

  function doJump(){
    if(go)return;
    go=true;clearInterval(tm);clearInterval(cdTm);
    tip.textContent='✅ Bore 隧道就绪，正在跳转…';
    setTimeout(function(){location.replace(B)},500);
  }

  async function poll(){
    try{
      // 如果已经确认 bore 可达，直接跳转
      if(boreReady){doJump();return;}

      var u=new URL(location.href);
      u.searchParams.set('status','1');u.searchParams.set('_',Date.now());
      var r=await fetch(u.toString(),{cache:'no-store'});
      var j=await r.json().catch(()=>({state:'Unknown'}));
      var s=j.state||'Unknown';
      pill.textContent='当前状态：'+s;
      tip.textContent=T[s]||('⏳ 状态：'+s);

      if(s==='Available'||j.ready){
        icon.className='check';icon.textContent='✓';
        t.textContent='✅ 服务已就绪';
        tip.textContent='⏳ 正在检测 Bore 隧道连通性…';
        // 先探测 bore
        var ok=await probeBore();
        if(ok){
          doJump();
          return;
        }
        // bore 不可达 → 显示等待状态，继续轮询探测
        icon.className='spin';icon.textContent='';
        t.textContent='⏳ 等待 Bore 隧道';
        tip.textContent='Codespace 已就绪，Bore 隧道尚未连通，请稍候…';
        etaTip.textContent='Bore 隧道建立中 · 预计 10–30 秒';
        // 启动单独的 bore 探测轮询（每 2 秒）
        if(!window._borePolling){
          window._borePolling=true;
          setInterval(async function(){
            if(boreReady)return;
            if(await probeBore()){
              tip.textContent='✅ Bore 隧道就绪，正在跳转…';
              doJump();
            }
          },2000);
        }
        return;
      }
      if(!started){
        started=true;
        var u2=new URL(location.href);u2.searchParams.set('start','1');
        fetch(u2.toString(),{method:'POST',cache:'no-store'}).catch(function(){});
      }
      // 实时状态反馈调整倒计时文字
      if(s==='Queued'||s==='Provisioning')etaTip.textContent='正在分配机器 · 请耐心等待';
      else if(s==='Starting')etaTip.textContent='Codespace 启动中 · 马上就好';
      else if(s==='Stopping')etaTip.textContent='上一次会话还在关闭 · 请稍候再启动';
    }catch(e){}
  }
  poll();tm=setInterval(poll,3000);
  setTimeout(function(){if(!go)clearInterval(tm)},240000);
})();
</script></body></html>`;
}

// Netlify Edge Function 入口
export default async (req) => {
  try {
    const u = new URL(req.url);
    const wantStatus = u.searchParams.has('status')
      || u.pathname === '/status';
    const wantStart  = req.method === 'POST' && u.searchParams.has('start');
    const wantHealth = u.pathname === '/health'
      || u.pathname === '/__health'
      || u.searchParams.has('health');

    // JSON: 健康检查
    if (wantHealth) {
      return new Response(
        JSON.stringify({ ok: true, t: Date.now(), hasPat: !!GH_PAT, cs: CODESPACE_NAME }),
        { headers: { 'Content-Type': 'application/json',
                     'Cache-Control': 'no-store',
                     'Access-Control-Allow-Origin': '*' } },
      );
    }

    // JSON: 状态查询（前端轮询用）
    if (wantStatus) {
      const { state } = await getCS();
      const ready = state === 'Available';
      return new Response(
        JSON.stringify({ state, ready, pendingMs: ready ? 4500 : 0, boreUrl: BORE_URL, aliyunUrl: ALIYUN_URL }),
        { headers: { 'Content-Type': 'application/json',
                     'Cache-Control': 'no-store',
                     'Access-Control-Allow-Origin': '*' } },
      );
    }

    // POST: 启动 Codespace（前端异步触发）
    if (wantStart) {
      startCS();
      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { 'Content-Type': 'application/json',
                     'Access-Control-Allow-Origin': '*' } },
      );
    }

    // === 主入口：GET / 或 GET /wake ===
    // 不再直接 302 跳转，而是返回 HTML 页面，让前端先探测 bore 可达性再跳转
    const { state } = await getCS();
    if (state === 'Available') {
      // 在 HTML 中前端会先探测 bore 再跳转，避免 bore 未就绪时空白页
      startCS(); // 确保服务保持运行
    } else {
      startCS();
    }
    return new Response(html(state), {
      status: 202,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store,no-cache,must-revalidate',
      },
    });
  } catch (e) {
    return new Response('error: ' + String(e), { status: 500 });
  }
};

// 配置：path 在 netlify.toml 里声明
export const config = {
  path: ['/', '/wake', '/status', '/health'],
};
