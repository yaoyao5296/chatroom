/**
 * 空闲检测中间件 —— 区分有效访问与无效请求
 *
 * 设计目标：
 *  1. 过滤掉健康检查、CF 探针、爬虫预取、OPTIONS 预检、静态资源探测等无效请求
 *  2. 只记录"真实用户访问"到最后访问时间文件
 *  3. 持久化到 ./data/last-access.json，防止脚本重启后数据丢失
 *  4. 写入采用 debounce + 异步落盘，避免每个请求都触发磁盘 I/O
 *
 * 空闲守护脚本（scripts/codespace-idle-watcher.mjs）读取本文件来判断是否该停 Codespace
 */
import type { Request, Response, NextFunction } from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 持久化文件路径
const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const LAST_ACCESS_FILE = path.join(DATA_DIR, 'last-access.json')

// ============ 无效请求过滤规则 ============
// 以下请求一律不计入"真实访问"，不更新 last-access

// 1) 健康检查路径
const HEALTH_PATHS = new Set([
  '/api/health',
  '/health',
  '/healthz',
  '/ready',
  '/ping',
  '/api/ping',
  '/_health',
  '/.well-known/health',
])

// 2) 用户代理特征：爬虫、监控、CF 内部探针、健康检查 bot
const BOT_UA_PATTERNS = [
  /kube-probe/i,
  /uptime[-_]?robot/i,
  /healthcheck/i,
  /pingdom/i,
  /statuscake/i,
  /newrelic/i,
  /crawlab/i,
  /better-uptime/i,
  /cloudflare/i,           // Cloudflare 健康检查 / 内部探针
  /always-on/i,            // Render/Railway 保活探针
  /github-camo/i,
  /favicon/i,              // 浏览器自动请求 favicon 不算真实访问
]

// 3) 静态资源探测：纯静态文件请求不算"业务访问"
//    （但 API 业务调用要算，比如 /api/messages）
const STATIC_FILE_EXT = /\.(?:ico|png|jpg|jpeg|gif|svg|css|js|map|woff2?|ttf|eot|txt|xml|webmanifest|wasm)$/i

// 4) 预取 / 探测请求头
function isPrefetchOrProbe(req: Request): boolean {
  const purpose = (req.headers['purpose'] || '').toString().toLowerCase()
  if (purpose === 'prefetch') return true
  const secPurpose = (req.headers['sec-purpose'] || '').toString().toLowerCase()
  if (secPurpose.includes('prefetch')) return true
  const xMoz = (req.headers['x-moz'] || '').toString().toLowerCase()
  if (xMoz === 'prefetch') return true
  // CF Worker 的探针请求（自定义标记）
  if (req.headers['x-cf-probe']) return true
  if (req.headers['x-codespace-probe']) return true
  return false
}

// ============ 状态文件读写 ============
interface AccessState {
  lastRealAccess: number   // 真实访问时间戳（ms）
  lastUpdate: number        // 文件最后写入时间戳
  totalRealAccesses: number // 累计真实访问次数（用于排查）
}

let cachedState: AccessState = {
  lastRealAccess: Date.now(),
  lastUpdate: 0,
  totalRealAccesses: 0,
}

let dirty = false
let flushTimer: NodeJS.Timeout | null = null

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadState(): void {
  try {
    if (fs.existsSync(LAST_ACCESS_FILE)) {
      const raw = fs.readFileSync(LAST_ACCESS_FILE, 'utf-8')
      const parsed = JSON.parse(raw)
      cachedState = {
        lastRealAccess: parsed.lastRealAccess || Date.now(),
        lastUpdate: parsed.lastUpdate || 0,
        totalRealAccesses: parsed.totalRealAccesses || 0,
      }
      console.log(`[idleTracker] 已加载状态：最后访问 ${new Date(cachedState.lastRealAccess).toISOString()}`)
    } else {
      // 文件不存在，用当前时间初始化（避免 Codespace 刚启动就被判定为"超时"）
      cachedState = {
        lastRealAccess: Date.now(),
        lastUpdate: 0,
        totalRealAccesses: 0,
      }
      dirty = true
      scheduleFlush()
    }
  } catch (err) {
    console.error('[idleTracker] 加载状态失败，使用默认值:', err)
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  // debounce 5 秒落盘一次，避免高频请求时频繁磁盘 I/O
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushToDisk()
  }, 5000)
}

function flushToDisk(): void {
  if (!dirty) return
  ensureDataDir()
  try {
    cachedState.lastUpdate = Date.now()
    fs.writeFileSync(LAST_ACCESS_FILE, JSON.stringify(cachedState, null, 2))
    dirty = false
  } catch (err) {
    console.error('[idleTracker] 落盘失败:', err)
  }
}

// 启动时加载状态
loadState()

// 进程退出时强制落盘，防止数据丢失
function flushOnExit(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  flushToDisk()
}
process.on('SIGTERM', flushOnExit)
process.on('SIGINT', flushOnExit)
process.on('beforeExit', flushOnExit)

// 每 30 秒兜底落盘一次（防止 debounce 计时器因事件循环空闲而延迟）
setInterval(() => {
  if (dirty) flushToDisk()
}, 30_000).unref()

// ============ 中间件 ============
export function idleTracker(req: Request, _res: Response, next: NextFunction): void {
  // 1) OPTIONS 预检不计入
  if (req.method === 'OPTIONS' || req.method === 'HEAD') {
    next()
    return
  }

  // 2) 健康检查路径不计入
  if (HEALTH_PATHS.has(req.path)) {
    next()
    return
  }

  // 3) User-Agent 命中爬虫/监控/探针
  const ua = (req.headers['user-agent'] || '').toString()
  if (ua && BOT_UA_PATTERNS.some((re) => re.test(ua))) {
    next()
    return
  }

  // 4) 预取 / 探测请求头
  if (isPrefetchOrProbe(req)) {
    next()
    return
  }

  // 5) 纯静态资源探测不计入（但 SPA 路由 / API 业务调用要算）
  //    SPA 的 HTML 入口（/ 路径）算真实访问（用户打开页面）
  if (req.path !== '/' && STATIC_FILE_EXT.test(req.path) && !req.path.startsWith('/api/')) {
    next()
    return
  }

  // ===== 命中以上过滤的都是"无效请求"，不更新 last-access =====
  // 走到这里说明是真实用户访问

  cachedState.lastRealAccess = Date.now()
  cachedState.totalRealAccesses++
  dirty = true
  scheduleFlush()

  next()
}

// 暴露给外部读取（idle-watcher 脚本可通过 require 或读文件）
export function getLastRealAccess(): number {
  return cachedState.lastRealAccess
}

export default idleTracker
