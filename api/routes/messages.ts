/**
 * 消息查询路由 —— 单核极限优化版
 */
import { Router, type Request, type Response } from 'express'
import { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

/**
 * 获取与某好友的聊天记录（分页 50 条）
 */
router.get('/:friendId', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const friendId = parseInt(req.params.friendId as string)
    const before = parseInt((req.query.before as string) || '0') || 0

    const baseQuery = before > 0
      ? `SELECT id, senderId, receiverId, content, type, fileUrl, timestamp
         FROM messages
         WHERE ((senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?))
           AND id < ?
         ORDER BY timestamp DESC
         LIMIT 50`
      : `SELECT id, senderId, receiverId, content, type, fileUrl, timestamp
         FROM messages
         WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?)
         ORDER BY timestamp DESC
         LIMIT 50`

    const messages = before > 0
      ? (stmtCache.get(baseQuery).all(userId, friendId, friendId, userId, before) as any[])
      : (stmtCache.get(baseQuery).all(userId, friendId, friendId, userId) as any[])

    // 统一为 ISO 格式 + "Z"
    for (const m of messages) {
      if (m.timestamp && typeof m.timestamp === 'string' && !m.timestamp.endsWith('Z')) {
        if (!m.timestamp.includes('T')) m.timestamp = m.timestamp.replace(' ', 'T')
        if (!m.timestamp.endsWith('Z')) m.timestamp = m.timestamp + 'Z'
      }
    }
    res.json({ success: true, messages: messages.reverse() })
  } catch (error: any) {
    console.error('[messages]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
