/**
 * Codespace 空闲守护 —— 10 分钟无真实用户访问则停止 Codespace 自身
 *
 * 工作流程：
 *  1. 每 60 秒读取 ./data/last-access.json
 *  2. 如果当前时间 - lastRealAccess > 阈值（默认 10 分钟），判定为空闲
 *  3. 调用 GitHub API POST /user/codespaces/{name}/stop 停止 Codespace
 *  4. 停止后本进程也会随之终止（Codespace 进入 Stopped 状态，不再计费）
 *
 * 防误停保护：
 *  - 启动后前 5 分钟不触发停止（warmup，避免刚启动就被停）
 *  - 服务健康检查失败时不触发停止（让运维先介入）
 *  - 停止前再次确认 last-access 没有被更新
 *
 * 环境变量：
 *  - GH_PAT：GitHub Personal Access Token（需要 codespace 权限）
 *            缺失时仅告警不真正停止
 *  - CODESPACE_NAME：Codespace 名称（Codespace 内自动注入）
 *  - IDLE_THRESHOLD_MIN：空闲阈值（分钟），默认 10
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.join(__dirname, '..')

const LAST_ACCESS_FILE = path.join(ROOT, 'data', 'last-access.json')
const STARTED_AT = Date.now()

const IDLE_THRESHOLD_MIN = parseInt(process.env.IDLE_THRESHOLD_MIN || '10', 10)
const IDLE_THRESHOLD_MS = IDLE_THRESHOLD_MIN * 60 * 1000
const WARMUP_MS = 5 * 60 * 1000         // 启动后 5 分钟内不触发停止
const CHECK_INTERVAL_MS = 60 * 1000     // 每 60 秒检查一次
const STOP_CONFIRM_DELAY_MS = 30 * 1000 // 停止前再等 30 秒确认（防误判）

// IDLE_WATCHER_MODE:
//   - "stop"    空闲超时 → 调用 GitHub API 停止 Codespace（需要 Cloudflare Worker 做唤醒入口，否则停了无法恢复）
//   - "monitor" 空闲超时 → 仅记录日志，不真正停止（推荐：无唤醒入口的默认模式，避免自杀）
const WATCHER_MODE = (process.env.IDLE_WATCHER_MODE || 'monitor').toLowerCase() === 'stop' ? 'stop' : 'monitor'

const GH_PAT = process.env.GH_PAT || ''
const CODESPACE_NAME = process.env.CODESPACE_NAME || ''

// ============ 日志 ============
function log(msg) {
  const ts = new Date().toISOString()
  console.log(`[idle-watcher] ${ts} ${msg}`)
}

// ============ 读取最后访问时间 ============
function getLastRealAccess() {
  try {
    if (!fs.existsSync(LAST_ACCESS_FILE)) {
      return { lastRealAccess: STARTED_AT, exists: false }
    }
    const raw = fs.readFileSync(LAST_ACCESS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return { lastRealAccess: parsed.lastRealAccess || 0, exists: true }
  } catch (err) {
    log(`读取 last-access 失败: ${err.message}`)
    return { lastRealAccess: STARTED_AT, exists: false }
  }
}

// ============ 服务健康检查 ============
async function isServiceHealthy() {
  try {
    const res = await fetch('http://localhost:3001/api/health', {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ============ 停止 Codespace ============
async function stopCodespace() {
  if (!GH_PAT) {
    log('⚠ GH_PAT 未设置，无法真正停止 Codespace（仅告警，将继续运行）')
    return false
  }
  if (!CODESPACE_NAME) {
    log('⚠ CODESPACE_NAME 未设置，无法停止')
    return false
  }
  log(`调用 GitHub API 停止 Codespace: ${CODESPACE_NAME}`)
  try {
    const res = await fetch(
      `https://api.github.com/user/codespaces/${encodeURIComponent(CODESPACE_NAME)}/stop`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GH_PAT}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15000),
      },
    )
    if (res.status === 202 || res.status === 200) {
      log('✓ Codespace 停止请求已提交，本进程即将终止')
      return true
    }
    const body = await res.text().catch(() => '')
    log(`✗ 停止失败: HTTP ${res.status} ${body.slice(0, 200)}`)
    return false
  } catch (err) {
    log(`✗ 停止异常: ${err.message}`)
    return false
  }
}

// ============ 主循环 ============
let stopped = false

async function checkOnce() {
  if (stopped) return

  // warmup 检查
  const uptime = Date.now() - STARTED_AT
  if (uptime < WARMUP_MS) {
    const remain = Math.ceil((WARMUP_MS - uptime) / 1000)
    log(`warmup 中，剩余 ${remain}s 后开始判定`)
    return
  }

  const { lastRealAccess } = getLastRealAccess()
  const idleMs = Date.now() - lastRealAccess
  const idleMin = (idleMs / 60000).toFixed(1)

  if (idleMs < IDLE_THRESHOLD_MS) {
    log(`活跃中，最后访问 ${idleMin} 分钟前（阈值 ${IDLE_THRESHOLD_MIN} 分钟）`)
    return
  }

  log(`⚠ 空闲超时：最后真实访问 ${idleMin} 分钟前 > 阈值 ${IDLE_THRESHOLD_MIN} 分钟`)

  // 停止前再确认服务状态
  const healthy = await isServiceHealthy()
  if (!healthy) {
    log('服务不健康，跳过停止（避免误判，等待下次检查）')
    return
  }

  // 二次确认：等待 30 秒后再读一次 last-access
  log(`等待 ${STOP_CONFIRM_DELAY_MS / 1000}s 二次确认...`)
  await new Promise((r) => setTimeout(r, STOP_CONFIRM_DELAY_MS))

  const recheck = getLastRealAccess()
  const recheckIdle = Date.now() - recheck.lastRealAccess
  if (recheckIdle < IDLE_THRESHOLD_MS) {
    log('二次确认期间有新访问，取消停止')
    return
  }

  log('二次确认通过，执行停止')
  const ok = await stopCodespace()
  if (ok) {
    stopped = true
    // 给 Codespace 一点时间处理停止请求
    setTimeout(() => process.exit(0), 5000)
  }
}

// ============ 启动 ============
log(`空闲守护启动`)
log(`  阈值: ${IDLE_THRESHOLD_MIN} 分钟`)
log(`  warmup: ${WARMUP_MS / 1000}s`)
log(`  CODESPACE_NAME: ${CODESPACE_NAME || '(未设置)'}`)
log(`  GH_PAT: ${GH_PAT ? '已设置' : '⚠ 未设置（不会真正停止）'}`)
log(`  状态文件: ${LAST_ACCESS_FILE}`)

// 启动后立即检查一次（如果文件已存在且已超时，但 warmup 会拦住）
checkOnce()
setInterval(checkOnce, CHECK_INTERVAL_MS)

// 兜底：进程退出时记录日志
process.on('SIGTERM', () => {
  log('收到 SIGTERM，退出')
  process.exit(0)
})
process.on('SIGINT', () => {
  log('收到 SIGINT，退出')
  process.exit(0)
})
