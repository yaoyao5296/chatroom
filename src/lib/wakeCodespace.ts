/**
 * Codespace 自动唤醒模块
 *
 * 用途：APK 打包后，API 指向 bore.pub 隧道。当 Codespace 休眠时隧道不可达，
 * 本模块通过 GitHub API 自动启动 Codespace，再轮询 bore.pub 直到连通。
 *
 * PAT 来源：localStorage['CHATROOM_GH_PAT']
 *   - 首次使用若没有 PAT，会 dispatchEvent('need-gh-pat')，App.tsx 弹出输入框让用户粘贴
 *   - 用户输入后存入 localStorage，唤醒继续
 *
 * 去重：并发请求只触发一次唤醒，所有请求共享同一个唤醒 Promise。
 */

import { isNativeApp } from './platform'

// 配置：构建时注入
const CODESPACE_NAME = import.meta.env.VITE_CODESPACE_NAME as string | undefined
const API_BASE = import.meta.env.VITE_API_BASE as string | undefined

// PAT 存储键
const PAT_KEY = 'CHATROOM_GH_PAT'

// 唤醒状态码
export type WakeState =
  | 'idle'
  | 'need-pat'      // 需要 PAT
  | 'starting'      // 正在启动 Codespace
  | 'waiting-bore'  // Codespace 已就绪，等 bore 隧道
  | 'ready'         // 全部就绪
  | 'failed'

// GitHub API 配置
const GH_HEADERS = (pat: string) => ({
  Authorization: `Bearer ${pat}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'chatroom-app-wake/1.0',
})
const GH_BASE = (name: string) =>
  `https://api.github.com/user/codespaces/${encodeURIComponent(name)}`

// ============ PAT 读写 ============
export function getStoredPAT(): string {
  try {
    return localStorage.getItem(PAT_KEY) || ''
  } catch {
    return ''
  }
}
export function setStoredPAT(pat: string) {
  try {
    localStorage.setItem(PAT_KEY, pat.trim())
  } catch {}
}
export function clearStoredPAT() {
  try {
    localStorage.removeItem(PAT_KEY)
  } catch {}
}

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

// ============ GitHub API 调用 ============
async function getCodespaceState(pat: string, name: string): Promise<string> {
  const r = await fetch(GH_BASE(name), {
    headers: GH_HEADERS(pat),
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`GitHub API ${r.status}`)
  const j = await r.json()
  return j.state || 'Unknown'
}

async function startCodespace(pat: string, name: string): Promise<void> {
  // 已 Available 就不重复 start
  const s = await getCodespaceState(pat, name)
  if (s === 'Available') return
  await fetch(GH_BASE(name) + '/start', {
    method: 'POST',
    headers: GH_HEADERS(pat),
  })
}

// ============ 探测 bore 隧道 ============
async function probeBore(boreOrigin: string): Promise<boolean> {
  try {
    await fetch(boreOrigin + '/', { mode: 'no-cors', cache: 'no-store' })
    return true
  } catch {
    return false
  }
}

// 从 API_BASE 提取 bore origin，例如 http://bore.pub:31425/api → http://bore.pub:31425
function boreOrigin(): string | null {
  if (!API_BASE) return null
  try {
    const u = new URL(API_BASE)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

// ============ 等待 PAT（用户输入） ============
function waitForPAT(timeoutMs = 120000): Promise<string> {
  const pat = getStoredPAT()
  if (pat) return Promise.resolve(pat)
  // 通知 UI 弹输入框
  setState('need-pat', { message: '需要 GitHub PAT 来唤醒服务器' })
  window.dispatchEvent(new CustomEvent('need-gh-pat'))
  return new Promise((resolve, reject) => {
    const onSet = (e: Event) => {
      const v = (e as CustomEvent).detail as string
      if (v) {
        window.removeEventListener('gh-pat-set', onSet)
        clearTimeout(timer)
        resolve(v)
      }
    }
    window.addEventListener('gh-pat-set', onSet)
    const timer = setTimeout(() => {
      window.removeEventListener('gh-pat-set', onSet)
      reject(new Error('等待 PAT 超时'))
    }, timeoutMs)
  })
}

// ============ 主入口：确保服务器已唤醒 ============
let wakePromise: Promise<void> | null = null

export function isWakeEnabled(): boolean {
  // 只在 APK（原生）+ API 指向 bore.pub 时启用
  return !!isNativeApp() && !!CODESPACE_NAME && !!boreOrigin()
}

export async function ensureServerAwake(): Promise<void> {
  if (!isWakeEnabled()) {
    // 非唤醒场景：直接放行（让上层走正常错误流程）
    return
  }
  // 已就绪：快速探测一次 bore
  const origin = boreOrigin()!
  if (await probeBore(origin)) {
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
  const origin = boreOrigin()!
  const name = CODESPACE_NAME!
  try {
    // 1. 拿 PAT
    const pat = await waitForPAT()
    // 2. 启动 Codespace
    setState('starting', { message: '正在启动 Codespace…' })
    await startCodespace(pat, name)
    // 3. 轮询 state 直到 Available（最多 4 分钟）
    setState('starting', { message: '等待 Codespace 就绪…' })
    const stateDeadline = Date.now() + 240000
    while (Date.now() < stateDeadline) {
      const s = await getCodespaceState(pat, name)
      if (s === 'Available') break
      await sleep(3000)
    }
    // 4. 轮询 bore 隧道（最多 90 秒）
    setState('waiting-bore', { message: '等待 Bore 隧道连通…' })
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
  } catch (err: any) {
    setState('failed', { message: err?.message || '唤醒失败' })
    throw err
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 通知 PAT 已设置（由 UI 输入框调用） */
export function notifyPATSet(pat: string) {
  setStoredPAT(pat)
  window.dispatchEvent(new CustomEvent('gh-pat-set', { detail: pat }))
}
