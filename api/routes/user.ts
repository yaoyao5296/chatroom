/**
 * 用户资料路由 —— 单核极限优化版
 */
import { Router, type Request, type Response } from 'express'
import { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

router.get('/me', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const user = stmtCache
      .get('SELECT id, username, avatar, bio, gender, region, active, vip, vipExpiresAt, phone, email FROM users WHERE id = ?')
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
      .get('SELECT id, username, avatar, bio, gender, region, active, vip, vipExpiresAt, phone, email FROM users WHERE id = ?')
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
      .get('SELECT id, username, avatar, bio, gender, region, active FROM users WHERE id = ?')
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
    const { username, bio, gender, region, avatar } = req.body

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

    const cur = stmtCache.get('SELECT username, bio, gender, region, avatar FROM users WHERE id = ?').get(userId) as any
    if (!cur) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    const newUsername = username !== undefined ? username : cur.username
    const newBio = bio !== undefined ? (bio as string) : cur.bio
    const newGender = gender !== undefined ? (gender as string) : cur.gender
    const newRegion = region !== undefined ? (region as string) : cur.region
    const newAvatar = avatar !== undefined ? (avatar as string) : cur.avatar

    stmtCache
      .get('UPDATE users SET username = ?, bio = ?, gender = ?, region = ?, avatar = ? WHERE id = ?')
      .run(newUsername, newBio, newGender, newRegion, newAvatar, userId)

    res.json({ success: true, user: { id: userId, username: newUsername, bio: newBio, gender: newGender, region: newRegion, avatar: newAvatar } })
  } catch (error: any) {
    console.error('[user-put]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 前端兼容别名：PUT /profile => 与 PUT /me 相同
router.put('/profile', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { username, bio, gender, region, avatar } = req.body

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

    const cur = stmtCache.get('SELECT username, bio, gender, region, avatar FROM users WHERE id = ?').get(userId) as any
    if (!cur) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    const newUsername = username !== undefined ? username : cur.username
    const newBio = bio !== undefined ? (bio as string) : cur.bio
    const newGender = gender !== undefined ? (gender as string) : cur.gender
    const newRegion = region !== undefined ? (region as string) : cur.region
    const newAvatar = avatar !== undefined ? (avatar as string) : cur.avatar

    stmtCache
      .get('UPDATE users SET username = ?, bio = ?, gender = ?, region = ?, avatar = ? WHERE id = ?')
      .run(newUsername, newBio, newGender, newRegion, newAvatar, userId)

    res.json({ success: true, user: { id: userId, username: newUsername, bio: newBio, gender: newGender, region: newRegion, avatar: newAvatar } })
  } catch (error: any) {
    console.error('[user-profile-put]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
