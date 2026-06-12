/**
 * 消息查询路由
 */
import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { JWT_SECRET } from './auth.js'

const router = Router()

function authMiddleware(req: Request, res: Response, next: any) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    ;(req as any).user = decoded
    next()
  } catch {
    res.status(401).json({ success: false, error: '登录已过期' })
  }
}

/**
 * 获取与某好友的聊天记录
 * GET /api/messages/:friendId
 */
router.get('/:friendId', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const friendId = parseInt(req.params.friendId)

    const messages = db.prepare(`
      SELECT id, senderId, receiverId, content, type, fileUrl, timestamp
      FROM messages
      WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?)
      ORDER BY timestamp ASC
      LIMIT 100
    `).all(userId, friendId, friendId, userId)

    res.json({ success: true, messages })
  } catch (error) {
    console.error('Get messages error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router