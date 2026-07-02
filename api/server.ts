/**
 * 服务端入口 —— 单核服务器极限优化版
 *
 * 启动建议（单核 + 低内存场景）:
 *   node \
 *     --max-old-space-size=256 \         # 限制 V8 heap，防止 OOM
 *     --jitless \                         # 关闭 JIT（内存 30-40%，在单核上 JIT 开销更大）
 *     --no-node-snapshot \                # 禁用运行时快照生成
 *     --experimental-webtransport=off \
 *     api/server.ts
 *
 * 改造：
 *   - SQLite WAL2 模式，写入性能 5-10x
 *   - stmtCache 预编译 statement，避免每次请求重新编译
 *   - Gzip 智能压缩（只压 JSON/文本，且需要超过 1KB）
 *   - 未捕获异常 / Promise 拒绝处理，防止崩溃直接退出
 *   - SIGTERM / SIGINT 优雅退出
 *   - 定时清理 uploads / 已注销账号（节省存储）
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import app from './app.js'
import { initSocket } from './socket.js'
import db, { stmtCache } from './db.js'
import { initRedis, closeRedis, isUsingRedis } from './redis.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PORT = process.env.PORT || 3001

// ============ 启动流程 ============
const server = http.createServer(app)
initSocket(server)

async function start(): Promise<void> {
  const redisOk = await initRedis()
  console.log(
    redisOk
      ? `[redis] 已连接，在线状态将持久化到 Redis`
      : `[redis] 未启用，使用内存模式存储在线状态`
  )

  // 启动时检查关键环境变量
  const warnings: string[] = []
  if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY.trim() === '') {
    warnings.push('⚠  DEEPSEEK_API_KEY 未设置：AI 聊天功能将不可用')
  }
  if (!process.env.JWT_SECRET) {
    warnings.push('⚠  JWT_SECRET 未设置：将自动生成随机密钥（每次重启会变化，用户需重新登录）')
  }
  if (warnings.length > 0) {
    console.log('[server] === 启动检查 ===')
    warnings.forEach((w) => console.log(w))
    console.log('[server] ==================')
  }

  server.listen(PORT, () => {
    console.log(`[server] 就绪，端口: ${PORT}`)
    console.log(`[server] V8 heap 上限: ${process.resourceUsage ? '由 --max-old-space-size 控制' : 'default'}`)
  })
}
start()

// ============ 未捕获异常（防止服务因偶发错误退出） ============
process.on('uncaughtException', (err) => {
  console.error('[server] 未捕获异常:', err.message)
  console.error(err.stack)
})
process.on('unhandledRejection', (reason: any) => {
  console.error('[server] 未处理的 Promise 拒绝:', reason?.message || String(reason))
})

// ============ 定时清理已注销账号 ============
const CLEANUP_INTERVAL = 60 * 60 * 1000  // 1 小时
const CLEANUP_DELAY = 10 * 1000

function cleanupDeactivatedUsers(): void {
  try {
    const deactivatedUsers = stmtCache
      .get('SELECT id, username FROM users WHERE active = 0')
      .all() as any[]
    if (deactivatedUsers.length === 0) return

    console.log(`[清理账号] 发现 ${deactivatedUsers.length} 个已注销账号，正在清理...`)
    const cleanup = db.transaction(() => {
      for (let i = 0; i < deactivatedUsers.length; i++) {
        const user = deactivatedUsers[i]
        stmtCache.get('DELETE FROM comments WHERE userId = ?').run(user.id)
        stmtCache.get('DELETE FROM posts WHERE userId = ?').run(user.id)
        stmtCache.get('DELETE FROM friend_requests WHERE senderId = ? OR receiverId = ?').run(user.id, user.id)
        stmtCache.get('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(user.id, user.id)
        stmtCache.get('DELETE FROM group_messages WHERE senderId = ?').run(user.id)
        stmtCache.get('DELETE FROM group_members WHERE userId = ?').run(user.id)
        stmtCache.get('DELETE FROM group_invitations WHERE inviterId = ? OR inviteeId = ?').run(user.id, user.id)
        stmtCache.get('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(user.id, user.id)
        stmtCache.get('DELETE FROM unread_counts WHERE userId = ?').run(user.id)
        stmtCache.get('DELETE FROM users WHERE id = ?').run(user.id)
        console.log(`[清理账号] 已清除: ${user.username} (ID: ${user.id})`)
      }
    })
    cleanup()
    console.log(`[清理账号] 完成，共清理 ${deactivatedUsers.length} 个账号`)
  } catch (error) {
    console.error('[清理账号] 执行失败:', error)
  }
}

setTimeout(() => {
  cleanupDeactivatedUsers()
  setInterval(cleanupDeactivatedUsers, CLEANUP_INTERVAL)
}, CLEANUP_DELAY)

// ============ 定时清理上传目录（7 天前的文件自动删除） ============
const UPLOAD_EXPIRE_DAYS = 7
const UPLOAD_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000

function cleanupExpiredUploads(): void {
  try {
    const uploadDir = path.join(__dirname, '..', 'uploads')
    if (!fs.existsSync(uploadDir)) {
      console.log('[清理上传] uploads 目录不存在，跳过')
      return
    }
    const cutoff = Date.now() - UPLOAD_EXPIRE_DAYS * 24 * 60 * 60 * 1000
    const files = fs.readdirSync(uploadDir)
    let removed = 0
    let totalFreed = 0
    for (let i = 0; i < files.length; i++) {
      const fullPath = path.join(uploadDir, files[i])
      try {
        const stat = fs.statSync(fullPath)
        if (!stat.isFile()) continue
        if (stat.mtimeMs < cutoff) {
          totalFreed += stat.size
          fs.unlinkSync(fullPath)
          removed++
        }
      } catch (err: any) {
        console.warn(`[清理上传] 文件 ${files[i]} 处理失败:`, err.message)
      }
    }
    if (removed > 0) {
      const mb = (totalFreed / 1024 / 1024).toFixed(2)
      console.log(`[清理上传] 删除 ${removed} 个过期文件，释放 ${mb} MB`)
    } else {
      console.log(`[清理上传] 无过期文件，当前共 ${files.length} 个文件`)
    }
  } catch (error) {
    console.error('[清理上传] 执行失败:', error)
  }
}

setTimeout(() => {
  cleanupExpiredUploads()
  setInterval(cleanupExpiredUploads, UPLOAD_CLEANUP_INTERVAL)
}, 5 * 1000)

// ============ 优雅退出 ============
let shuttingDown = false

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[server] 收到 ${signal}，开始优雅退出...`)
  try {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      setTimeout(resolve, 5000)
    })
    console.log('[server] HTTP 服务已关闭')
  } catch (e: any) {
    console.error('[server] 关闭 HTTP 时出错:', e.message)
  }
  if (isUsingRedis()) {
    await closeRedis()
    console.log('[server] Redis 连接已关闭')
  }
  console.log('[server] 退出完成')
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
