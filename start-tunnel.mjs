import fs from 'fs';
import path from 'path';
const LT_DIR = '/data/data/com.termux/files/usr/lib/node_modules/localtunnel';
const OPENURL = path.join(LT_DIR, 'node_modules/openurl/openurl.js');
if (fs.existsSync(OPENURL)) {
  const content = fs.readFileSync(OPENURL, 'utf8');
  if (content.includes('Unsupported platform')) {
    fs.writeFileSync(OPENURL, "module.exports = { open: function(){}, mailto: function(){} };\n");
  }
}
const localtunnelMod = await import(LT_DIR + '/localtunnel.js');
const localtunnel = localtunnelMod.default || localtunnelMod;

const PORT = Number(process.argv[2]) || 3001;
const SUBDOMAIN = process.argv[3] || 'chatroom-zjp';
const EXPECTED_HOST = `${SUBDOMAIN}.loca.lt`;
const CONNECT_TIMEOUT_MS = 15000; // 15秒连不上就放弃

let tunnel = null;
let retryCount = 0;
let connectTimer = null;
let alive = true;

function clearConnectTimer() {
  if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
}

function closeTunnel() {
  clearConnectTimer();
  try { if (tunnel) tunnel.close(); } catch {}
  tunnel = null;
}

async function startTunnel() {
  if (!alive) return;
  try {
    retryCount++;
    console.log(`[tunnel] 请求子域名: ${SUBDOMAIN} (第${retryCount}次尝试)`);

    // 超时保护：15秒没拿到结果就强制断开
    let timedOut = false;
    connectTimer = setTimeout(() => {
      timedOut = true;
      console.log(`[tunnel] ⏱️  连接超时(${CONNECT_TIMEOUT_MS/1000}s)，重来`);
      closeTunnel();
      scheduleReconnect();
    }, CONNECT_TIMEOUT_MS);

    const tunnelPromise = localtunnel({ port: PORT, subdomain: SUBDOMAIN });
    const got = await Promise.race([
      tunnelPromise,
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), CONNECT_TIMEOUT_MS + 100))
    ]).catch(e => null);

    if (timedOut || !got) {
      // 已经在 timer 里处理了 或者 真的失败了
      return;
    }

    clearConnectTimer();
    tunnel = got;
    const gotUrl = tunnel.url || '';

    if (!gotUrl.includes(EXPECTED_HOST)) {
      console.log(`[tunnel] ⚠️  拿到随机域名 ${gotUrl}，不符合要求，断开重来`);
      closeTunnel();
      scheduleReconnect(2000);
      return;
    }

    retryCount = 0;
    console.log(`[tunnel] ✅ 成功！公网地址: ${gotUrl} [${new Date().toLocaleString('zh-CN')}]`);

    tunnel.on('close', () => {
      console.log('[tunnel] 连接关闭，准备重连...');
      scheduleReconnect();
    });
    tunnel.on('error', (e) => {
      console.error('[tunnel] 出错:', (e && e.message) || String(e).slice(0, 200));
      closeTunnel();
      scheduleReconnect();
    });
  } catch (e) {
    clearConnectTimer();
    console.error('[tunnel] 启动失败:', (e && e.message) || String(e).slice(0, 200));
    closeTunnel();
    scheduleReconnect();
  }
}

function scheduleReconnect(delay) {
  if (!alive) return;
  const base = delay || Math.min(1000 * Math.pow(1.2, Math.min(retryCount, 20)), 15000);
  const jitter = Math.random() * 2000;
  const wait = base + jitter;
  console.log(`[tunnel] ${(wait/1000).toFixed(1)}秒后重试...`);
  setTimeout(startTunnel, wait);
}

process.on('SIGINT',  () => { alive = false; closeTunnel(); process.exit(0); });
process.on('SIGTERM', () => { alive = false; closeTunnel(); process.exit(0); });

startTunnel();
