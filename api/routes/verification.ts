/**
 * 验证码路由（简化实现） —— 单核极限优化版
 */
import { Router, type Request, type Response } from 'express'
import { stmtCache } from '../db.js'

const router = Router()

router.post('/send', (req: Request, res: Response): void => {
  try {
    const { target } = req.body as { target?: string }
    if (!target) {
      res.status(400).json({ success: false, error: '请输入目标' })
      return
    }

    // 6 位数字验证码（开发模式直接返回）
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const now = new Date()
    const expires = new Date(now.getTime() + 10 * 60 * 1000) // 10 分钟
    const isoExpires = expires.toISOString()

    stmtCache
      .get('INSERT INTO verification_codes (target, code, expiresAt, type) VALUES (?, ?, ?, ?)')
      .run(target, code, isoExpires, 'register')

    res.json({
      success: true,
      message: '验证码已发送',
      ...(process.env.NODE_ENV !== 'production' ? { code } : {}),
    })
  } catch (error: any) {
    console.error('[verify-send]', error?.message || error)
    res.status(500).json({ success: false, error: '发送失败' })
  }
})

export default router
