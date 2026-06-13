/**
 * 好友管理路由
 */
import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { JWT_SECRET } from './auth.js'

const router = Router()

// JWT 验证中间件
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
 * 获取好友列表
 * GET /api/friends
 */
router.get('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id

    const friends = db.prepare(`
      SELECT u.id, u.username, u.avatar, u.active
      FROM friendships f
      JOIN users u ON u.id = f.friendId
      WHERE f.userId = ?
      UNION
      SELECT u.id, u.username, u.avatar, u.active
      FROM friendships f
      JOIN users u ON u.id = f.userId
      WHERE f.friendId = ?
    `).all(userId, userId) as any[]

    res.json({ success: true, friends })
  } catch (error) {
    console.error('Get friends error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 添加好友
 * POST /api/friends/add
 */
router.post('/add', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { username } = req.body

    if (!username) {
      res.status(400).json({ success: false, error: '请输入用户名' })
      return
    }

    // 不能添加自己
    if (username === (req as any).user.username) {
      res.status(400).json({ success: false, error: '不能添加自己为好友' })
      return
    }

    // 查找用户
    const friend = db.prepare('SELECT id, username FROM users WHERE username = ? AND active = 1').get(username) as any
    if (!friend) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    // 检查是否已是好友
    const existing = db.prepare(`
      SELECT id FROM friendships
      WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)
    `).get(userId, friend.id, friend.id, userId)

    if (existing) {
      res.status(400).json({ success: false, error: '已经是好友了' })
      return
    }

    // 添加好友
    db.prepare('INSERT INTO friendships (userId, friendId) VALUES (?, ?)').run(userId, friend.id)

    res.json({
      success: true,
      friend: { id: friend.id, username: friend.username },
    })
  } catch (error) {
    console.error('Add friend error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 删除好友
 * DELETE /api/friends/:friendId
 */
router.delete('/:friendId', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const friendId = parseInt(req.params.friendId)

    const deleteAll = db.transaction(() => {
      // 删除好友关系
      const result = db.prepare(`
        DELETE FROM friendships
        WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)
      `).run(userId, friendId, friendId, userId)

      if (result.changes === 0) {
        return null
      }

      // 删除与该好友的所有聊天记录
      db.prepare(`
        DELETE FROM messages
        WHERE (senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?)
      `).run(userId, friendId, friendId, userId)

      return result
    })

    const result = deleteAll()
    if (!result) {
      res.status(404).json({ success: false, error: '好友关系不存在' })
      return
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Delete friend error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 搜索用户
 * GET /api/friends/search?q=username
 */
router.get('/search', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const q = req.query.q as string

    if (!q) {
      res.json({ success: true, users: [] })
      return
    }

    const users = db.prepare(`
      SELECT id, username FROM users
      WHERE username LIKE ? AND id != ? AND active = 1
      LIMIT 10
    `).all(`%${q}%`, userId)

    res.json({ success: true, users })
  } catch (error) {
    console.error('Search users error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router