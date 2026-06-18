/**
 * 服务端入口
 *
 * 改造：
 * - 启动时初始化 Redis（用于在线状态持久化，崩溃后可恢复）
 * - 增加未捕获异常 / Promise 拒绝处理（防止崩溃直接退出）
 * - SIGTERM / SIGINT 优雅退出：关闭 Redis、关闭 socket、退出
 * - 定时清理 uploads 目录（超过 7 天的文件自动删除，节省存储）
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import app from './app.js'
import { initSocket } from './socket.js'
import db from './db.js'
import { initRedis, closeRedis, isUsingRedis } from './redis.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PORT = process.env.PORT || 3001

const server = http.createServer(app)
initSocket(server)

// ========== 启动流程 ==========
async function start() {
  const redisOk = await initRedis()
  if (redisOk) {
    console.log(`[redis] 已连接，在线状态将持久化到 Redis`)
  } else {
    console.log(`[redis] 未启用，使用内存模式存储在线状态`)
  }
  server.listen(PORT, () => {
    console.log(`[server] 就绪，端口: ${PORT}`)
  })
}

start()

// ========== 未捕获异常（防止服务因偶发错误退出） ==========
process.on('uncaughtException', (err) => {
  console.error('[server] 未捕获异常:', err.message)
  console.error(err.stack)
})

process.on('unhandledRejection', (reason: any) => {
  console.error('[server] 未处理的 Promise 拒绝:', reason?.message || String(reason))
})

// ========== 定时清理已注销账号 ==========
const CLEANUP_INTERVAL = 60 * 60 * 1000
const CLEANUP_DELAY = 10 * 1000

function cleanupDeactivatedUsers() {
  try {
    const deactivatedUsers = db.prepare('SELECT id, username FROM users WHERE active = 0').all() as any[]
    if (deactivatedUsers.length === 0) return
    console.log(`[清理账号] 发现 ${deactivatedUsers.length} 个已注销账号，正在清理...`)
    const cleanup = db.transaction(() => {
      for (const user of deactivatedUsers) {
        db.prepare('DELETE FROM friend_requests WHERE senderId = ? OR receiverId = ?').run(user.id, user.id)
        db.prepare('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(user.id, user.id)
        db.prepare('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(user.id, user.id)
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
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

// ========== 定时清理上传目录（7 天前的文件自动删除） ==========
const UPLOAD_EXPIRE_DAYS = 7
const UPLOAD_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000 // 24 小时一次

function cleanupExpiredUploads() {
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
    for (const file of files) {
      const fullPath = path.join(uploadDir, file)
      try {
        const stat = fs.statSync(fullPath)
        if (!stat.isFile()) continue
        if (stat.mtimeMs < cutoff) {
          const size = stat.size
          fs.unlinkSync(fullPath)
          removed++
          totalFreed += size
        }
      } catch (err: any) {
        console.warn(`[清理上传] 文件 ${file} 处理失败:`, err.message)
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
}, 5 * 1000) // 启动后 5 秒先执行一次

// ========== 优雅退出 ==========
let shuttingDown = false

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[server] 收到 ${signal}，开始优雅退出...`)
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
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
