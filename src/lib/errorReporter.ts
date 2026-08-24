/**
 * 客户端错误自主检测与上报
 * - 捕获全局未处理错误
 * - 捕获未处理的 Promise 拒绝
 * - 拦截 console.error
 * - 自动上报到服务器
 * - 去重防止重复上报
 * - 监听服务端紧急停服通知
 */

import { getSocket } from './socket'

interface ErrorReport {
  type: 'error' | 'unhandledrejection' | 'console'
  message: string
  stack?: string
  url: string
  lineno?: number
  colno?: number
  timestamp: number
  userAgent: string
  pageUrl: string
}

const REPORT_URL = '/api/error/report'
const MAX_REPORTS_PER_MINUTE = 10
const DEDUP_WINDOW_MS = 5000

// 去重：相同错误 5 秒内不重复上报
const recentErrors = new Map<string, number>()
let reportCount = 0
let reportTimer = 0

// 紧急停服标记
let serviceDown = false

function dedupe(key: string): boolean {
  const now = Date.now()
  const last = recentErrors.get(key)
  if (last && now - last < DEDUP_WINDOW_MS) return false
  recentErrors.set(key, now)
  if (recentErrors.size > 50) {
    for (const [k, v] of recentErrors) {
      if (now - v > DEDUP_WINDOW_MS) recentErrors.delete(k)
    }
  }
  return true
}

function sendReport(report: ErrorReport): void {
  if (serviceDown) return // 服务已停，不再上报
  const now = Date.now()
  if (now - reportTimer > 60000) {
    reportTimer = now
    reportCount = 0
  }
  if (reportCount >= MAX_REPORTS_PER_MINUTE) return
  reportCount++

  try {
    fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => {})
  } catch {}
}

function buildReport(
  type: ErrorReport['type'],
  message: string,
  stack?: string,
  lineno?: number,
  colno?: number,
): ErrorReport {
  return {
    type,
    message: String(message).slice(0, 500),
    stack: stack ? String(stack).slice(0, 2000) : undefined,
    url: typeof window !== 'undefined' ? window.location.href : '',
    lineno,
    colno,
    timestamp: Date.now(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    pageUrl: typeof window !== 'undefined' ? window.location.href : '',
  }
}

/**
 * 显示服务错误遮罩
 */
function showServiceErrorOverlay(message: string): void {
  if (typeof document === 'undefined') return
  // 移除已有遮罩
  const existing = document.getElementById('service-error-overlay')
  if (existing) existing.remove()

  const overlay = document.createElement('div')
  overlay.id = 'service-error-overlay'
  overlay.innerHTML = `
    <div style="
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.85); z-index: 99999;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-family: system-ui, sans-serif; color: #fff; text-align: center;
    ">
      <div style="font-size: 64px; margin-bottom: 20px; animation: pulse 1.5s infinite;">⚠️</div>
      <h2 style="font-size: 24px; margin: 0 0 10px; font-weight: 600;">服务出错，正在修复</h2>
      <p style="font-size: 14px; color: #999; margin: 0 0 30px; max-width: 400px; line-height: 1.6;">
        ${message || '系统检测到异常，已自动暂停服务以保护数据安全。请稍后再试。'}
      </p>
      <div style="display: flex; gap: 12px;">
        <button onclick="location.reload()" style="
          padding: 10px 24px; border: none; border-radius: 8px;
          background: #4f46e5; color: #fff; font-size: 14px; cursor: pointer;
        ">重新连接</button>
        <button onclick="document.getElementById('service-error-overlay')?.remove()" style="
          padding: 10px 24px; border: 1px solid #555; border-radius: 8px;
          background: transparent; color: #999; font-size: 14px; cursor: pointer;
        ">关闭</button>
      </div>
      <style>
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }
      </style>
    </div>
  `
  document.body.appendChild(overlay)
}

/**
 * 初始化 Socket.IO 监听（服务端紧急停服通知）
 */
function initServiceErrorListener(): void {
  const sock = getSocket()
  if (!sock) return

  sock.on('service_error', (data: { type: string; message: string; detail: string }) => {
    console.warn('[ErrorReporter] 收到服务端停服通知:', data)
    serviceDown = true
    showServiceErrorOverlay(data.detail || data.message)
  })
}

/**
 * 初始化错误监控
 */
export function initErrorReporter(): void {
  if (typeof window === 'undefined') return

  // 监听服务端停服通知
  initServiceErrorListener()

  // 1. 捕获 window.onerror
  window.addEventListener('error', (event: ErrorEvent) => {
    const key = `${event.message}|${event.filename}|${event.lineno}`
    if (!dedupe(key)) return

    const report = buildReport(
      'error',
      event.message || '未知错误',
      event.error?.stack,
      event.lineno,
      event.colno,
    )
    sendReport(report)
  })

  // 2. 捕获未处理的 Promise 拒绝
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    const key = `rejection|${message}`
    if (!dedupe(key)) return

    const report = buildReport('unhandledrejection', message, stack)
    sendReport(report)
  })

  // 3. 拦截 console.error
  const originalConsoleError = console.error.bind(console)
  console.error = function (...args: any[]) {
    originalConsoleError(...args)

    const message = args.map((a) => {
      if (a instanceof Error) return a.message
      if (typeof a === 'object') {
        try { return JSON.stringify(a).slice(0, 200) } catch { return '[Object]' }
      }
      return String(a)
    }).join(' ')

    if (
      message.includes('React') ||
      message.includes('Warning:') ||
      message.includes('[HMR]') ||
      message.includes('vite') ||
      message.includes('Sentry')
    ) {
      return
    }

    const key = `console|${message}`
    if (!dedupe(key)) return

    const stack = args[0] instanceof Error ? (args[0] as Error).stack : undefined
    sendReport(buildReport('console', message, stack))
  }

  console.log('[ErrorReporter] 错误监控已启动')
}

/**
 * 手动上报错误
 */
export function reportError(error: Error | string, context?: string): void {
  const message = error instanceof Error ? error.message : error
  const stack = error instanceof Error ? error.stack : undefined
  const fullMessage = context ? `[${context}] ${message}` : message
  sendReport(buildReport('error', fullMessage, stack))
}

/**
 * 查询服务是否已停服
 */
export function isServiceDown(): boolean {
  return serviceDown
}