/**
 * 共享认证中间件 & JWT 工具
 *
 * 优化：
 *  1) 统一 authMiddleware —— 消除 4+ 份重复副本
 *  2) JWT 本地缓存（按 token 哈希 + 过期时间）：避免每次重复校验
 *  3) JWT_SECRET 从环境变量读取，没有则使用默认值
 */
import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'

export const JWT_SECRET = process.env.JWT_SECRET || 'chat-secret-key-2024'
export const JWT_EXPIRES = '7d'

// JWT 验证结果缓存（单核下 JWT verify 是 CPU 大头，单次 ~0.1-0.3ms）
// 容量 256，LRU 淘汰；缓存时长 60s（足够又防止 token 撤销漏判）
interface CacheEntry {
  payload: any
  expireAt: number
}
const JWT_CACHE_MAX = 256
const JWT_CACHE_TTL = 60 * 1000
const jwtCache = new Map<string, CacheEntry>()

function decodeFromCacheOrVerify(token: string): any {
  const now = Date.now()
  const cached = jwtCache.get(token)
  if (cached && cached.expireAt > now) {
    return cached.payload
  }
  // 超过容量，先清掉已过期的（简单策略：清前 1/4）
  if (jwtCache.size >= JWT_CACHE_MAX) {
    let removed = 0
    const keys = jwtCache.keys()
    for (const k of keys) {
      const v = jwtCache.get(k)
      if (!v || v.expireAt <= now) {
        jwtCache.delete(k)
      } else if (removed < JWT_CACHE_MAX / 4) {
        jwtCache.delete(k)
        removed++
      } else {
        break
      }
    }
  }
  const payload = jwt.verify(token, JWT_SECRET)
  jwtCache.set(token, { payload, expireAt: now + JWT_CACHE_TTL })
  return payload
}

/**
 * 认证中间件 —— 所有 API 路由共享同一份，零重复
 */
export function authMiddleware(req: Request, res: Response, next: any): void {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }
  const token = authHeader.slice(7) // 比 split(' ')[1] 少分配一次数组
  if (!token) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }
  try {
    const decoded = decodeFromCacheOrVerify(token) as any
    ;(req as any).user = decoded
    next()
  } catch {
    res.status(401).json({ success: false, error: '登录已过期' })
  }
}
