/**
 * Redis 连接管理器
 * - 存储在线用户（崩溃重启后可恢复，保持在线人数不变）
 * - 存储当前会话（用于未读计数判断）
 * - 延迟下线机制（短时间断网重连不算下线）
 * 
 * 未配置 REDIS_URL 时自动降级为内存模式（不影响单机开发）
 */
import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const ONLINE_TTL = 30          // 用户在线记录 TTL（秒）。前端每 10s 心跳
const OFFLINE_GRACE = 20       // 延迟下线宽限期（秒）。掉线后 20s 内重连不算下线

const NS_ONLINE = 'chatroom:online'
const NS_SESSION = 'chatroom:session'
const NS_PENDING = 'chatroom:offline_pending'

let client: Redis | null = null
let fallback = false // 未配置 Redis 时使用内存回退
let memOnline = new Map<number, { socketId: string; ts: number }>()
let memSessions = new Map<number, string>()
let memPending = new Map<number, { socketId: string; timer: any }>()

function redis(): Redis | null {
  if (fallback) return null
  if (client) return client

  try {
    client = new Redis(REDIS_URL, {
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 200,
    })
    client.on('error', (err) => {
      console.error('[redis] 连接错误:', err.message)
    })
    client.on('ready', () => {
      console.log('[redis] 已就绪')
    })
    return client
  } catch (err: any) {
    console.warn('[redis] 初始化失败，降级为内存模式:', err.message)
    fallback = true
    return null
  }
}

/** 尝试连接 Redis，失败则降级到内存模式 */
export async function initRedis(): Promise<boolean> {
  const r = redis()
  if (!r) return false
  try {
    await r.ping()
    return true
  } catch (err: any) {
    console.warn('[redis] ping 失败，降级为内存模式:', err.message)
    fallback = true
    return false
  }
}

export function isUsingRedis(): boolean {
  return !fallback && client !== null
}

/** 用户上线 / 心跳 */
export async function markOnline(userId: number, socketId: string): Promise<boolean> {
  const r = redis()
  if (r) {
    const pipe = r.pipeline()
    pipe.setex(`${NS_ONLINE}:${userId}`, ONLINE_TTL, socketId)
    pipe.sadd(NS_ONLINE, String(userId))
    // 清除待下线标记（如果存在）
    pipe.del(`${NS_PENDING}:${userId}`)
    await pipe.exec()
    // 检查是否在待下线期内重连（即 20s 内是否已有下线计划）
    // 返回 true = 是真正的上线事件（需要广播），false = 是短时间重连（不广播）
    // 这里简化：由调用方在 connect 时判断 pending 是否存在
    return true
  }

  // 内存模式
  const prev = memPending.get(userId)
  if (prev) {
    clearTimeout(prev.timer)
    memPending.delete(userId)
  }
  memOnline.set(userId, { socketId, ts: Date.now() })
  return true
}

/** 检查用户是否在"待下线"期内（返回 true 表示短时间重连，不广播上下线） */
export async function isInGracePeriod(userId: number): Promise<boolean> {
  const r = redis()
  if (r) {
    const exists = await r.exists(`${NS_PENDING}:${userId}`)
    return exists === 1
  }
  return memPending.has(userId)
}

/** 延迟下线（收到 disconnect 后设置 grace period） */
export function scheduleOffline(
  userId: number,
  socketId: string,
  username: string,
  doOffline: (userId: number, username: string) => void,
): void {
  const r = redis()

  if (r) {
    // Redis 模式：写入 pending key，TLL=OFFLINE_GRACE
    r.setex(`${NS_PENDING}:${userId}`, OFFLINE_GRACE, socketId).catch(() => {})

    // 同时本地也建一个 setTimeout（兜底，防止进程重启后不触发）
    // 真正的下线检查由后端扫描任务执行
    // 但为了保证低延迟，本地设置一个 timer（进程重启时丢失，此时扫描任务兜底）
    setTimeout(async () => {
      const stillPending = await r.exists(`${NS_PENDING}:${userId}`)
      if (stillPending === 1) {
        const stillOnline = await r.exists(`${NS_ONLINE}:${userId}`)
        if (!stillOnline) {
          // 真正下线
          await r.del(`${NS_PENDING}:${userId}`)
          await r.srem(NS_ONLINE, String(userId))
          doOffline(userId, username)
        }
      }
    }, OFFLINE_GRACE * 1000 + 500)
    return
  }

  // 内存模式
  memOnline.delete(userId)
  const timer = setTimeout(() => {
    if (memPending.has(userId)) {
      memPending.delete(userId)
      doOffline(userId, username)
    }
  }, OFFLINE_GRACE * 1000)
  memPending.set(userId, { socketId, timer })
}

/** 获取用户 socketId（用于发送定向消息） */
export async function getUserSocketId(userId: number): Promise<string | null> {
  const r = redis()
  if (r) {
    return await r.get(`${NS_ONLINE}:${userId}`)
  }
  return memOnline.get(userId)?.socketId || null
}

/** 获取所有在线用户 ID */
export async function getAllOnlineUserIds(): Promise<number[]> {
  const r = redis()
  if (r) {
    const members = await r.smembers(NS_ONLINE)
    // 过滤掉已过期的（set 可能存在脏数据，通过再次检查 key 来过滤）
    const pipe = r.pipeline()
    members.forEach((m) => pipe.exists(`${NS_ONLINE}:${m}`))
    const results = await pipe.exec()
    const valid: number[] = []
    members.forEach((m, i) => {
      const [err, res] = results[i]
      if (!err && res === 1) valid.push(Number(m))
    })
    // 清理已过期的 set 成员
    const expired = members.filter((_, i) => {
      const [err, res] = results[i]
      return err || res !== 1
    })
    if (expired.length) await r.srem(NS_ONLINE, ...expired)
    return valid
  }
  // 内存模式：简单返回所有
  return Array.from(memOnline.keys())
}

/** 获取在线人数 */
export async function getOnlineCount(): Promise<number> {
  const r = redis()
  if (r) {
    return await r.scard(NS_ONLINE)
  }
  return memOnline.size
}

/** 刷新用户 TTL（收到前端心跳时） */
export async function heartbeat(userId: number, socketId: string): Promise<void> {
  const r = redis()
  if (r) {
    // 检查当前存储的 socketId 是否匹配（多端登录或重连时 socket 可能变）
    const cur = await r.get(`${NS_ONLINE}:${userId}`)
    if (cur === socketId) {
      await r.expire(`${NS_ONLINE}:${userId}`, ONLINE_TTL)
    } else if (cur) {
      // 另一 socket 关联的同一个 userId，刷新该记录
      await r.setex(`${NS_ONLINE}:${userId}`, ONLINE_TTL, socketId)
    } else {
      await r.setex(`${NS_ONLINE}:${userId}`, ONLINE_TTL, socketId)
      await r.sadd(NS_ONLINE, String(userId))
    }
    return
  }
  if (memOnline.has(userId)) {
    memOnline.set(userId, { socketId, ts: Date.now() })
  } else {
    memOnline.set(userId, { socketId, ts: Date.now() })
  }
}

/** 活跃会话（未读计数判断） */
export async function setActiveSession(userId: number, sessionKey: string | null): Promise<void> {
  const r = redis()
  if (r) {
    if (sessionKey) {
      await r.setex(`${NS_SESSION}:${userId}`, 600, sessionKey) // 10 分钟 TTL
    } else {
      await r.del(`${NS_SESSION}:${userId}`)
    }
    return
  }
  if (sessionKey) memSessions.set(userId, sessionKey)
  else memSessions.delete(userId)
}

export async function getActiveSession(userId: number): Promise<string | null> {
  const r = redis()
  if (r) {
    return await r.get(`${NS_SESSION}:${userId}`)
  }
  return memSessions.get(userId) || null
}

/** 后台扫描任务：定期清理过期用户（Redis Set 去重） */
export function startOnlineCleanup(): void {
  const r = redis()
  if (r) {
    // 每 60s 扫描一次 online set，与真实 key 做对比，清理不存在的
    setInterval(async () => {
      try {
        const members = await r.smembers(NS_ONLINE)
        const pipe = r.pipeline()
        members.forEach((m) => pipe.exists(`${NS_ONLINE}:${m}`))
        const results = await pipe.exec()
        const expired: string[] = []
        members.forEach((m, i) => {
          const [err, res] = results[i]
          if (err || res !== 1) expired.push(m)
        })
        if (expired.length) {
          await r.srem(NS_ONLINE, ...expired)
          console.log(`[redis] 清理 ${expired.length} 个过期在线用户`)
        }
      } catch (e: any) {
        console.error('[redis] 清理失败:', e.message)
      }
    }, 60 * 1000)
  } else {
    // 内存模式
    setInterval(() => {
      const now = Date.now()
      for (const [uid, info] of memOnline.entries()) {
        if (now - info.ts > ONLINE_TTL * 1000) {
          memOnline.delete(uid)
        }
      }
    }, 60 * 1000)
  }
}

/** 清理 Redis 连接（优雅退出时） */
export async function closeRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit()
    } catch {}
    client = null
  }
}
