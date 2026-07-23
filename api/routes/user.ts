/**
 * 用户资料路由 —— 单核极限优化版
 */
import { Router, type Request, type Response } from 'express'
import db, { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

router.get('/me', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const user = stmtCache
      .get('SELECT id, username, avatar, bio, gender, region, age, active, vip, vipExpiresAt, phone, email, isOfficial FROM users WHERE id = ?')
      .get(userId) as any
    if (!user) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }
    res.json({ success: true, user })
  } catch (error: any) {
    console.error('[user-me]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 前端兼容：调用 /user/profile 时也能正确返回
router.get('/profile', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const user = stmtCache
      .get('SELECT id, username, avatar, bio, gender, region, age, active, vip, vipExpiresAt, phone, email, isOfficial FROM users WHERE id = ?')
      .get(userId) as any
    if (!user) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }
    res.json({ success: true, user })
  } catch (error: any) {
    console.error('[user-profile]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

router.get('/:id', authMiddleware, (req: Request, res: Response): void => {
  try {
    const targetId = parseInt(req.params.id as string)
    const user = stmtCache
      .get('SELECT id, username, avatar, bio, gender, region, age, active, isOfficial FROM users WHERE id = ?')
      .get(targetId) as any
    if (!user) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }
    res.json({ success: true, user })
  } catch (error: any) {
    console.error('[user-get]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

router.put('/me', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { username, bio, gender, region, avatar, age } = req.body

    if (username !== undefined && (typeof username !== 'string' || username.length < 2 || username.length > 20)) {
      res.status(400).json({ success: false, error: '用户名长度需在 2-20 之间' })
      return
    }

    const existing = username
      ? stmtCache.get('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId) as any
      : null
    if (existing) {
      res.status(400).json({ success: false, error: '用户名已被使用' })
      return
    }

    const cur = stmtCache.get('SELECT username, bio, gender, region, avatar, age FROM users WHERE id = ?').get(userId) as any
    if (!cur) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    const newUsername = username !== undefined ? username : cur.username
    const newBio = bio !== undefined ? (bio as string) : cur.bio
    const newGender = gender !== undefined ? (gender as string) : cur.gender
    const newRegion = region !== undefined ? (region as string) : cur.region
    const newAvatar = avatar !== undefined ? (avatar as string) : cur.avatar
    const newAge = age !== undefined ? (age as number) : cur.age

    stmtCache
      .get('UPDATE users SET username = ?, bio = ?, gender = ?, region = ?, avatar = ?, age = ? WHERE id = ?')
      .run(newUsername, newBio, newGender, newRegion, newAvatar, newAge, userId)

    res.json({ success: true, user: { id: userId, username: newUsername, bio: newBio, gender: newGender, region: newRegion, avatar: newAvatar, age: newAge } })
  } catch (error: any) {
    console.error('[user-put]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 前端兼容别名：PUT /profile => 与 PUT /me 相同
router.put('/profile', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { username, bio, gender, region, avatar, age } = req.body

    if (username !== undefined && (typeof username !== 'string' || username.length < 2 || username.length > 20)) {
      res.status(400).json({ success: false, error: '用户名长度需在 2-20 之间' })
      return
    }

    const existing = username
      ? stmtCache.get('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId) as any
      : null
    if (existing) {
      res.status(400).json({ success: false, error: '用户名已被使用' })
      return
    }

    const cur = stmtCache.get('SELECT username, bio, gender, region, avatar, age FROM users WHERE id = ?').get(userId) as any
    if (!cur) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    const newUsername = username !== undefined ? username : cur.username
    const newBio = bio !== undefined ? (bio as string) : cur.bio
    const newGender = gender !== undefined ? (gender as string) : cur.gender
    const newRegion = region !== undefined ? (region as string) : cur.region
    const newAvatar = avatar !== undefined ? (avatar as string) : cur.avatar
    const newAge = age !== undefined ? (age as number) : cur.age

    stmtCache
      .get('UPDATE users SET username = ?, bio = ?, gender = ?, region = ?, avatar = ?, age = ? WHERE id = ?')
      .run(newUsername, newBio, newGender, newRegion, newAvatar, newAge, userId)

    res.json({ success: true, user: { id: userId, username: newUsername, bio: newBio, gender: newGender, region: newRegion, avatar: newAvatar, age: newAge } })
  } catch (error: any) {
    console.error('[user-profile-put]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 更新头像接口
router.post('/avatar', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { avatar } = req.body

    if (!avatar || typeof avatar !== 'string') {
      res.status(400).json({ success: false, error: '缺少头像地址' })
      return
    }

    stmtCache
      .get('UPDATE users SET avatar = ? WHERE id = ?')
      .run(avatar, userId)

    res.json({ success: true, avatar })
  } catch (error: any) {
    console.error('[user-avatar-post]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 注销账号（彻底删除所有数据）
router.post('/deactivate', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id

    const cleanup = db.transaction(() => {
      // 删除该用户的所有评论
      stmtCache.get('DELETE FROM comments WHERE userId = ?').run(userId)
      // 删除该用户发布的动态（已有评论在上面先删了）
      stmtCache.get('DELETE FROM posts WHERE userId = ?').run(userId)
      // 删除好友请求
      stmtCache.get('DELETE FROM friend_requests WHERE senderId = ? OR receiverId = ?').run(userId, userId)
      // 删除好友关系
      stmtCache.get('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(userId, userId)
      // 删除群聊消息
      stmtCache.get('DELETE FROM group_messages WHERE senderId = ?').run(userId)
      // 删除群聊成员
      stmtCache.get('DELETE FROM group_members WHERE userId = ?').run(userId)
      // 删除群聊邀请
      stmtCache.get('DELETE FROM group_invitations WHERE inviterId = ? OR inviteeId = ?').run(userId, userId)
      // 删除私聊消息
      stmtCache.get('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(userId, userId)
      // 删除未读计数
      stmtCache.get('DELETE FROM unread_counts WHERE userId = ?').run(userId)
      // 删除验证码
      stmtCache.get('DELETE FROM verification_codes WHERE target = (SELECT email FROM users WHERE id = ?)').run(userId)
      // 删除用户
      stmtCache.get('DELETE FROM users WHERE id = ?').run(userId)
    })
    cleanup()

    res.json({ success: true, message: '账号已注销，所有数据已清除' })
  } catch (error: any) {
    console.error('[user-deactivate]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
