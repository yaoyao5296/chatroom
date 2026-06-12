/**
 * 用户认证路由
 */
import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../db.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'chat-secret-key-2024'
const JWT_EXPIRES = '7d'

/**
 * 用户注册
 * POST /api/auth/register
 * Body: { username, email, password }
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password } = req.body

    if (!username || !email || !password) {
      res.status(400).json({ success: false, error: '用户名、邮箱和密码不能为空' })
      return
    }

    if (username.length < 2 || username.length > 20) {
      res.status(400).json({ success: false, error: '用户名长度需在2-20个字符之间' })
      return
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, error: '密码长度不能少于6个字符' })
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ success: false, error: '请输入正确的邮箱格式' })
      return
    }

    const activeUser = db.prepare('SELECT id FROM users WHERE username = ? AND active = 1').get(username)
    if (activeUser) {
      res.status(400).json({ success: false, error: '用户名已存在' })
      return
    }

    const emailActive = db.prepare('SELECT id FROM users WHERE email = ? AND active = 1').get(email)
    if (emailActive) {
      res.status(400).json({ success: false, error: '该邮箱已被注册' })
      return
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    // 如果存在已注销的同名用户，彻底清除旧记录（好友关系、聊天记录）
    const deactivatedUser = db.prepare('SELECT id FROM users WHERE username = ? AND active = 0').get(username) as any

    if (deactivatedUser) {
      const oldId = deactivatedUser.id
      const cleanup = db.transaction(() => {
        db.prepare('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(oldId, oldId)
        db.prepare('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(oldId, oldId)
        db.prepare('DELETE FROM users WHERE id = ?').run(oldId)
      })
      cleanup()
    }

    // 创建全新账号
    const result = db.prepare('INSERT INTO users (username, password, email) VALUES (?, ?, ?)')
      .run(username, hashedPassword, email)
    const userId = result.lastInsertRowid as number

    const token = jwt.sign(
      { id: userId, username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    )

    res.status(201).json({
      success: true,
      user: { id: userId, username, email, avatar: '' },
      token,
    })
  } catch (error) {
    console.error('Register error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 用户登录（支持用户名/手机号/邮箱）
 * POST /api/auth/login
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { loginId, password } = req.body

    if (!loginId || !password) {
      res.status(400).json({ success: false, error: '请输入账号和密码' })
      return
    }

    const user = db.prepare(`
      SELECT id, username, password, phone, email, avatar FROM users
      WHERE (username = ? OR phone = ? OR email = ?) AND active = 1
    `).get(loginId, loginId, loginId) as any

    if (!user) {
      res.status(401).json({ success: false, error: '账号或密码错误' })
      return
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      res.status(401).json({ success: false, error: '账号或密码错误' })
      return
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    )

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone || '',
        email: user.email || '',
        avatar: user.avatar || '',
      },
      token,
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export { JWT_SECRET }
export default router