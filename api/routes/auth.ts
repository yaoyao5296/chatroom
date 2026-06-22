/**
 * 用户认证路由 —— 单核极限优化版
 *
 * 优化：
 *  - bcrypt cost 8（10 太贵，单核下 8 已足够安全且快 2x）
 *  - 所有 SQL 使用 stmtCache 预编译
 *  - 登录查询只查必要字段，不读冗余列
 *  - 人脸登录：基于感知哈希 (dHash) + 注册时的 faceDescriptor
 *  - 修改密码：需要登录态 + 校验旧密码
 */
import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db, { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'chat-secret-key-2024'
const JWT_EXPIRES = '7d'
const BCRYPT_COST = 8 // 单核下 cost 10 ~180ms，cost 8 ~50ms，对普通用户足够安全

/**
 * 发送好友请求（验证码发送/校验 —— 简单实现，走 stmtCache）
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password } = req.body

    if (!username || !password) {
      res.status(400).json({ success: false, error: '用户名和密码不能为空' })
      return
    }
    if (username.length < 2 || username.length > 20) {
      res.status(400).json({ success: false, error: '用户名长度需在 2-20 之间' })
      return
    }
    if (password.length < 6) {
      res.status(400).json({ success: false, error: '密码长度不能少于 6 个字符' })
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ success: false, error: '邮箱格式不正确' })
      return
    }

    const userExists = stmtCache.get('SELECT id FROM users WHERE username = ? AND active = 1').get(username) as any
    if (userExists) {
      res.status(400).json({ success: false, error: '用户名已存在' })
      return
    }

    if (email) {
      const emailExists = stmtCache.get('SELECT id FROM users WHERE email = ? AND active = 1').get(email) as any
      if (emailExists) {
        res.status(400).json({ success: false, error: '该邮箱已被注册' })
        return
      }
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST)

    // 如果存在已注销的同名用户，彻底清除旧记录
    const deactivated = stmtCache.get('SELECT id FROM users WHERE username = ? AND active = 0').get(username) as any
    if (deactivated) {
      const tx = db.transaction((oldId: number) => {
        stmtCache.get('DELETE FROM friendships WHERE userId = ? OR friendId = ?').run(oldId, oldId)
        stmtCache.get('DELETE FROM messages WHERE senderId = ? OR receiverId = ?').run(oldId, oldId)
        stmtCache.get('DELETE FROM users WHERE id = ?').run(oldId)
      })
      tx(deactivated.id)
    }

    const insertResult = stmtCache
      .get('INSERT INTO users (username, password, email) VALUES (?, ?, ?)')
      .run(username, hashedPassword, email || '')
    const userId = insertResult.lastInsertRowid as number

    const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES })

    res.status(201).json({
      success: true,
      user: { id: userId, username, email: email || '', avatar: '', bio: '', gender: '', region: '', vip: 0 },
      token,
    })
  } catch (error: any) {
    console.error('[register]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

/**
 * 用户登录（支持用户名/手机号/邮箱）
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { loginId, password } = req.body
    if (!loginId || !password) {
      res.status(400).json({ success: false, error: '请输入账号和密码' })
      return
    }

    const user = stmtCache
      .get(`SELECT id, username, password, avatar, bio, gender, region, vip, vipExpiresAt
           FROM users
           WHERE (username = ? OR phone = ? OR email = ?) AND active = 1`)
      .get(loginId, loginId, loginId) as any

    if (!user) {
      res.status(401).json({ success: false, error: '账号或密码错误' })
      return
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      res.status(401).json({ success: false, error: '账号或密码错误' })
      return
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES })

    const nowIso = new Date().toISOString()
    const vip = user.vip === 1 && user.vipExpiresAt && user.vipExpiresAt > nowIso ? 1 : 0

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone || '',
        email: user.email || '',
        avatar: user.avatar || '',
        bio: user.bio || '',
        gender: user.gender || '',
        region: user.region || '',
        vip,
      },
      token,
    })
  } catch (error: any) {
    console.error('[login]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// ==================== 人脸登录 / 注册 ====================
// 策略：由前端采集人脸图像后生成描述符（如 128 维特征向量或简化 dHash）
// 本后端存储 faceDescriptor（字符串形式），比较时用余弦相似度

// 工具：解析描述符字符串 "0.12,0.34,..." 为 number[]
function parseDescriptor(s: string | null | undefined): number[] | null {
  if (!s) return null
  const arr = s
    .split(',')
    .map((x) => parseFloat(x.trim()))
    .filter((x) => Number.isFinite(x))
  return arr.length >= 4 ? arr : null
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  if (d === 0) return 0
  return dot / d
}

// 1) 为人脸注册或更新描述符（需要已登录）
router.post('/face/register', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id as number
    const { faceDescriptor } = req.body
    const parsed = parseDescriptor(faceDescriptor)
    if (!parsed) {
      res.status(400).json({ success: false, error: '无效的人脸特征数据' })
      return
    }
    const descriptor = parsed.map((x) => Math.round(x * 10000) / 10000).join(',')
    stmtCache
      .get('UPDATE users SET faceDescriptor = ? WHERE id = ?')
      .run(descriptor, userId)
    res.json({ success: true, message: '人脸信息已保存，可用于登录' })
  } catch (error: any) {
    console.error('[face-register]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// 2) 人脸登录：用户提供描述符 + 用户名（可选）
//    - 有用户名：只在该用户的描述符上匹配，相似度 > 阈值即通过
//    - 无用户名：在全部用户描述符上匹配（N 个用户线性扫描，用户量 > 1000 请使用向量数据库）
//    - 阈值默认 0.85（余弦相似度），可以调
router.post('/face/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, faceDescriptor } = req.body
    const parsed = parseDescriptor(faceDescriptor)
    if (!parsed) {
      res.status(400).json({ success: false, error: '无效的人脸特征数据' })
      return
    }

    const threshold = 0.85
    let matchedUser: any = null
    let bestScore = threshold

    if (username) {
      const row = stmtCache
        .get(`SELECT id, username, password, avatar, bio, gender, region, vip, vipExpiresAt, faceDescriptor
             FROM users WHERE username = ? AND active = 1`)
        .get(username) as any
      if (row && row.faceDescriptor) {
        const stored = parseDescriptor(row.faceDescriptor)
        if (stored) {
          const score = cosineSimilarity(parsed, stored)
          if (score > bestScore) {
            bestScore = score
            matchedUser = row
          }
        }
      }
    } else {
      // 全表扫描，取最匹配者
      const rows = stmtCache
        .get(`SELECT id, username, password, avatar, bio, gender, region, vip, vipExpiresAt, faceDescriptor
             FROM users WHERE active = 1 AND faceDescriptor IS NOT NULL AND faceDescriptor != ''`)
        .all() as any[]
      for (let i = 0; i < rows.length; i++) {
        const stored = parseDescriptor(rows[i].faceDescriptor)
        if (!stored) continue
        const score = cosineSimilarity(parsed, stored)
        if (score > bestScore) {
          bestScore = score
          matchedUser = rows[i]
        }
      }
    }

    if (!matchedUser) {
      res.status(401).json({ success: false, error: '未找到匹配的人脸，请先注册或重试' })
      return
    }

    const token = jwt.sign({ id: matchedUser.id, username: matchedUser.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES })

    const nowIso = new Date().toISOString()
    const vip = matchedUser.vip === 1 && matchedUser.vipExpiresAt && matchedUser.vipExpiresAt > nowIso ? 1 : 0

    res.json({
      success: true,
      score: Math.round(bestScore * 10000) / 10000,
      user: {
        id: matchedUser.id,
        username: matchedUser.username,
        phone: matchedUser.phone || '',
        email: matchedUser.email || '',
        avatar: matchedUser.avatar || '',
        bio: matchedUser.bio || '',
        gender: matchedUser.gender || '',
        region: matchedUser.region || '',
        vip,
      },
      token,
    })
  } catch (error: any) {
    console.error('[face-login]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// ==================== 修改密码 ====================
// 需要：已登录 + 旧密码正确 + 新密码 >= 6 位
router.post('/password', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id as number
    const { oldPassword, newPassword } = req.body
    if (!oldPassword || !newPassword) {
      res.status(400).json({ success: false, error: '请提供旧密码和新密码' })
      return
    }
    if (newPassword.length < 6) {
      res.status(400).json({ success: false, error: '新密码长度不能少于 6 个字符' })
      return
    }

    const user = stmtCache.get('SELECT password FROM users WHERE id = ?').get(userId) as any
    if (!user) {
      res.status(404).json({ success: false, error: '用户不存在' })
      return
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password)
    if (!isMatch) {
      res.status(401).json({ success: false, error: '旧密码不正确' })
      return
    }

    const hashed = await bcrypt.hash(newPassword, BCRYPT_COST)
    stmtCache.get('UPDATE users SET password = ? WHERE id = ?').run(hashed, userId)

    res.json({ success: true, message: '密码修改成功，请使用新密码登录' })
  } catch (error: any) {
    console.error('[password-update]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

// ==================== 忘记密码 ====================
// 免登录，通过用户名重置密码（项目无邮件/短信服务，简化流程）
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, newPassword } = req.body
    if (!username || !newPassword) {
      res.status(400).json({ success: false, error: '请提供用户名和新密码' })
      return
    }
    if (newPassword.length < 6) {
      res.status(400).json({ success: false, error: '新密码长度不能少于 6 个字符' })
      return
    }

    const user = stmtCache.get('SELECT id, username FROM users WHERE username = ?').get(username.trim()) as any
    if (!user) {
      res.status(404).json({ success: false, error: '未找到该用户，请检查用户名是否正确' })
      return
    }

    const hashed = await bcrypt.hash(newPassword, BCRYPT_COST)
    stmtCache.get('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id)

    res.json({ success: true, message: '密码已重置成功，请使用新密码登录' })
  } catch (error: any) {
    console.error('[forgot-password]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

export default router
