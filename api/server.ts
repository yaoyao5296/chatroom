/**
 * 服务端入口
 * 
 * 改造：
 * - 启动时初始化 Redis（用于在线状态持久化，崩溃后可恢复）
 * - 增加未捕获异常 / Promise 拒绝处理（防止崩溃直接退出）
 * - SIGTERM / SIGINT 优雅退出：关闭 Redis、关闭 socket、退出
 */
import http from 'http'
import app from './app.js'
import { initSocket } from './socket.js'
import db from './db.js'
import { initRedis, closeRedis, isUsingRedis } from './redis.js'

const PORT = process.env.PORT || 3001

const server = http.createServer(app)
initSocket(server)

// ========== 启动流程 ==========
async function start() {
  const redisOk = await initRedis()
  if (redisOk) {
    console.log(`[redis] 已连接，在线状态将持久化到 Redis`)
  } else {
    console.log(`[redis] 未启用（未配置或连接失败），使用内存模式存储在线状态`)
    console.log(`[redis] 提示：配置 REDIS_URL=redis://127.0.0.1:6379 可启用崩溃恢复特性`)
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
  // 不立即退出：记录错误后继续运行
  // 注：这是一个兜底策略。严重错误最终可能需要重启，但可尽量延长服务时间
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

    console.log(`[清理] 发现 ${deactivatedUsers.length} 个已注销账号，正在清理...`)

    const cleanup = db.transaction(() => {
      for (const user of deactivatedUsers) {
        db.prepare('DELETE FROM friend_requests WHERE senderId = ? OR receiverId = ?').run(user.id, user.id)
        db.prepare('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(user.id, user.id)
        db.prepare('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(user.id, user.id)
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
        console.log(`[清理] 已清除账号: ${user.username} (ID: ${user.id})`)
      }
    })

    cleanup()
    console.log(`[清理] 完成，共清理 ${deactivatedUsers.length} 个账号`)
  } catch (error) {
    console.error('[清理] 执行失败:', error)
  }
}

setTimeout(() => {
  cleanupDeactivatedUsers()
  setInterval(cleanupDeactivatedUsers, CLEANUP_INTERVAL)
}, CLEANUP_DELAY)

// ========== 优雅退出 ==========
let shuttingDown = false

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`[server] 收到 ${signal}，开始优雅退出...`)

  // 不再接收新连接
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
      // 最多等 5 秒
      setTimeout(resolve, 5000)
    })
    console.log('[server] HTTP 服务已关闭')
  } catch (e: any) {
    console.error('[server] 关闭 HTTP 时出错:', e.message)
  }

  // 关闭 Redis 连接
  if (isUsingRedis()) {
    await closeRedis()
    console.log('[server] Redis 连接已关闭')
  }

  console.log('[server] 退出完成')
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
