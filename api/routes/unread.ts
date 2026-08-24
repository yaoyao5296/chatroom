/**
 * 未读计数路由 —— 单核极限优化版
 */
import { Router, type Request, type Response } from 'express'
import { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

router.get('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const unreadList = stmtCache
      .get(`SELECT targetType, targetId, count, lastMessage, lastSenderId, lastTimestamp
           FROM unread_counts
           WHERE userId = ?`)
      .all(userId) as any[]

    // 加上 friend-request 待处理请求数
    const requestCount = (stmtCache
      .get('SELECT COUNT(*) AS count FROM friend_requests WHERE receiverId = ? AND status = ?')
      .get(userId, 'pending') as any).count

    const total = unreadList.reduce<number>((acc, u) => acc + (u.count || 0), 0) + requestCount

    res.json({ success: true, unread: unreadList, requestCount, total })
  } catch (error: any) {
    console.error('[unread]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

router.post('/clear', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { targetType, targetId } = req.body
    if (!targetType || targetId === undefined || targetId === null) {
      res.status(400).json({ success: false, error: '参数错误' })
      return
    }
    stmtCache
      .get('UPDATE unread_counts SET count = 0 WHERE userId = ? AND targetType = ? AND targetId = ?')
      .run(userId, String(targetType), Number(targetId))
    res.json({ success: true })
  } catch (error: any) {
    console.error('[unread-mark]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
