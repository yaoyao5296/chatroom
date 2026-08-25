/**
 * Codespace 自动唤醒模块（PAT-free 版）
 *
 * 设计：APK 不再持有 GitHub PAT，所有唤醒操作通过一个云端 Edge Function 代管。
 * 当前实现：Netlify Edge Function（netlify/edge-functions/wake.js）
 *   - GET  {WAKE_URL}?status=1   → 返回 { state, ready, boreUrl, ... }
 *   - POST {WAKE_URL}?start=1    → 触发 Codespace 启动（PAT 由 Netlify 环境变量代管）
 *
 * 用户视角：打开 APK → 网络不通 → APP 自动调唤醒接口 → 60~120 秒后自动进入
 * 仓库主只需要在 Netlify 后台设一次 GH_PAT，所有用户零感知。
 */

import { isNativeApp } from './platform'

// 配置：构建时注入
const WAKE_URL = import.meta.env.VITE_WAKE_URL as string | undefined
const API_BASE = import.meta.env.VITE_API_BASE as string | undefined

// 唤醒状态
export type WakeState =
  | 'idle'
  | 'starting'      // 正在启动 Codespace
  | 'waiting-bore'  // Codespace 已就绪，等 bore 隧道
  | 'ready'
  | 'failed'

// ============ 兼容旧 API（保留导出，内部不再使用） ============
// 旧版本把 PAT 存 localStorage，新版本不再需要。保留这两个函数只是为了让
// 老的 App.tsx 不会编译失败 —— 实际不会调用。
export function getStoredPAT(): string {
  return ''
}
export function setStoredPAT(_pat: string) {}
export function clearStoredPAT() {}
export function notifyPATSet(_pat: string) {}

// ============ 唤醒进度事件 ============
let lastState: WakeState = 'idle'
export function getWakeState() {
  return lastState
}
function setState(s: WakeState, extra?: { message?: string }) {
  lastState = s
  window.dispatchEvent(
    new CustomEvent('wake-progress', { detail: { state: s, ...extra } })
  )
}

// ============ 探测 bore 隧道 ============
// 从 API_BASE 提取 origin，例如 http://bore.pub:31425/api → http://bore.pub:31425
function boreOrigin(): string | null {
  if (!API_BASE) return null
  try {
    const u = new URL(API_BASE)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

async function probeBore(boreOrigin: string): Promise<boolean> {
  try {
    await fetch(boreOrigin + '/', { mode: 'no-cors', cache: 'no-store' })
    return true
  } catch {
    return false
  }
}

// ============ 调 Netlify Edge Function ============
async function fetchWakeStatus(): Promise<{ state: string; ready: boolean }> {
  if (!WAKE_URL) return { state: 'Unknown', ready: false }
  const u = new URL(WAKE_URL)
  u.searchParams.set('status', '1')
  u.searchParams.set('_', String(Date.now()))
  try {
    const r = await fetch(u.toString(), { cache: 'no-store' })
    if (!r.ok) return { state: 'Unknown', ready: false }
    const j = await r.json().catch(() => ({ state: 'Unknown' }))
    return {
      state: j.state || 'Unknown',
      ready: j.ready === true || j.state === 'Available',
    }
  } catch {
    return { state: 'Unknown', ready: false }
  }
}

async function triggerWakeStart(): Promise<void> {
  if (!WAKE_URL) return
  const u = new URL(WAKE_URL)
  u.searchParams.set('start', '1')
  u.searchParams.set('_', String(Date.now()))
  try {
    await fetch(u.toString(), {
      method: 'POST',
      cache: 'no-store',
    })
  } catch {
    // 忽略：状态轮询会重试
  }
}

// ============ 主入口：确保服务器已唤醒 ============
let wakePromise: Promise<void> | null = null

export function isWakeEnabled(): boolean {
  // 只在 APK（原生）+ 配置了 WAKE_URL 时启用
  return !!isNativeApp() && !!WAKE_URL
}

export async function ensureServerAwake(): Promise<void> {
  if (!isWakeEnabled()) return

  // 快通道：bore 已通就放行
  const origin = boreOrigin()
  if (origin && (await probeBore(origin))) {
    setState('ready', { message: '服务器在线' })
    return
  }

  // 去重：并发请求复用同一个唤醒流程
  if (!wakePromise) {
    wakePromise = doWake().finally(() => {
      wakePromise = null
    })
  }
  await wakePromise
}

async function doWake(): Promise<void> {
  try {
    // 1. 先查一次状态，如果已 Available，直接等 bore
    let { state, ready } = await fetchWakeStatus()

    // 2. 如果未就绪，触发启动
    if (!ready) {
      setState('starting', { message: '正在启动 Codespace…' })
      await triggerWakeStart()
    }

    // 3. 轮询 state 直到 Available（最多 4 分钟）
    const stateDeadline = Date.now() + 240000
    while (Date.now() < stateDeadline && !ready) {
      await sleep(3000)
      const r = await fetchWakeStatus()
      state = r.state
      ready = r.ready
      if (state === 'Queued' || state === 'Provisioning') {
        setState('starting', { message: '正在分配机器…' })
      } else if (state === 'Starting') {
        setState('starting', { message: 'Codespace 启动中…' })
      } else if (state === 'Available') {
        break
      }
    }

    if (!ready) {
      setState('failed', { message: 'Codespace 启动超时' })
      throw new Error('Codespace 启动超时')
    }

    // 4. 轮询 bore 隧道（最多 90 秒）
    setState('waiting-bore', { message: '等待 Bore 隧道连通…' })
    const origin = boreOrigin()
    if (origin) {
      const boreDeadline = Date.now() + 90000
      while (Date.now() < boreDeadline) {
        if (await probeBore(origin)) {
          setState('ready', { message: '服务器已就绪' })
          return
        }
        await sleep(2000)
      }
      setState('failed', { message: 'Bore 隧道未就绪' })
      throw new Error('Bore 隧道未就绪')
    }

    // 没有 bore origin 配置，认为就绪
    setState('ready', { message: '服务器已就绪' })
  } catch (err: any) {
    setState('failed', { message: err?.message || '唤醒失败' })
    throw err
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
