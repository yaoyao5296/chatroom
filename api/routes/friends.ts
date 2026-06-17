/**
 * 好友管理路由（需对方同意）
 */
import { Router, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { JWT_SECRET } from './auth.js'
import { getIO } from '../socket.js'

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
 * 发送好友请求
 * POST /api/friends/request
 */
router.post('/request', authMiddleware, (req: Request, res: Response): void => {
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

    // 检查是否有待处理的请求（双向）
    const pending = db.prepare(`
      SELECT id, status FROM friend_requests
      WHERE ((senderId = ? AND receiverId = ?) OR (senderId = ? AND receiverId = ?))
        AND status = 'pending'
    `).get(userId, friend.id, friend.id, userId) as any

    if (pending) {
      if (pending.senderId === userId) {
        res.status(400).json({ success: false, error: '已发送过好友请求，请等待对方同意' })
      } else {
        // 对方已经发过请求，自动同意
        db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run('accepted', pending.id)
        db.prepare('INSERT INTO friendships (userId, friendId) VALUES (?, ?)').run(userId, friend.id)

        // 通知双方好友列表更新
        const io = getIO()
        if (io) {
          io.to(userId.toString()).emit('friend_added')
          io.to(friend.id.toString()).emit('friend_added')
        }

        res.json({ success: true, message: '对方已向你发送过好友请求，已自动添加为好友', friend: { id: friend.id, username: friend.username } })
        return
      }
      return
    }

    // 插入好友请求
    db.prepare('INSERT OR IGNORE INTO friend_requests (senderId, receiverId) VALUES (?, ?)').run(userId, friend.id)

    // 检查是否因 UNIQUE 约束插入失败
    const dup = db.prepare(`
      SELECT status FROM friend_requests WHERE senderId = ? AND receiverId = ?
    `).get(userId, friend.id) as any

    if (!dup) {
      // 说明之前是反向请求被拒绝了，现在重新发
      db.prepare('INSERT INTO friend_requests (senderId, receiverId) VALUES (?, ?)').run(userId, friend.id)
    } else if (dup.status === 'rejected') {
      // 之前被拒绝过，更新为 pending
      db.prepare('UPDATE friend_requests SET status = ? WHERE senderId = ? AND receiverId = ?').run('pending', userId, friend.id)
    }

    // 通知接收者
    const io = getIO()
    if (io) {
      io.to(friend.id.toString()).emit('friend_request', {
        id: dup?.id || db.prepare('SELECT id FROM friend_requests WHERE senderId = ? AND receiverId = ?').get(userId, friend.id)?.id,
        senderId: userId,
        senderUsername: (req as any).user.username,
      })
    }

    res.json({ success: true, message: '好友请求已发送' })
  } catch (error) {
    console.error('Send friend request error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 处理好友请求（同意/拒绝）
 * POST /api/friends/respond
 * Body: { requestId, action: 'accept' | 'reject' }
 */
router.post('/respond', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { requestId, action } = req.body

    if (!requestId || !['accept', 'reject'].includes(action)) {
      res.status(400).json({ success: false, error: '参数错误' })
      return
    }

    const request = db.prepare(
      'SELECT * FROM friend_requests WHERE id = ? AND receiverId = ? AND status = ?'
    ).get(requestId, userId, 'pending') as any

    if (!request) {
      res.status(404).json({ success: false, error: '请求不存在或已处理' })
      return
    }

    const io = getIO()

    if (action === 'accept') {
      // 同意：添加好友关系
      db.transaction(() => {
        db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run('accepted', requestId)
        db.prepare('INSERT INTO friendships (userId, friendId) VALUES (?, ?)').run(userId, request.senderId)
      })()

      // 通知双方更新好友列表
      if (io) {
        io.to(userId.toString()).emit('friend_added')
        io.to(request.senderId.toString()).emit('friend_request_responded', { accepted: true })
        // 也通知发送者更新好友列表
        io.to(request.senderId.toString()).emit('friend_added')
      }

      res.json({ success: true, message: '已同意好友请求' })
    } else {
      // 拒绝
      db.prepare('UPDATE friend_requests SET status = ? WHERE id = ?').run('rejected', requestId)

      if (io) {
        io.to(request.senderId.toString()).emit('friend_request_responded', { accepted: false })
      }

      res.json({ success: true, message: '已拒绝好友请求' })
    }
  } catch (error) {
    console.error('Respond friend request error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 获取待处理的好友请求
 * GET /api/friends/requests
 */
router.get('/requests', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id

    const requests = db.prepare(`
      SELECT fr.id, fr.senderId, fr.status, fr.createdAt, u.username AS senderUsername, u.avatar AS senderAvatar
      FROM friend_requests fr
      JOIN users u ON u.id = fr.senderId
      WHERE fr.receiverId = ? AND fr.status = 'pending'
      ORDER BY fr.createdAt DESC
    `).all(userId) as any[]

    res.json({ success: true, requests })
  } catch (error) {
    console.error('Get requests error:', error)
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
      const result = db.prepare(`
        DELETE FROM friendships
        WHERE (userId = ? AND friendId = ?) OR (userId = ? AND friendId = ?)
      `).run(userId, friendId, friendId, userId)

      if (result.changes === 0) {
        return null
      }

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