/**
 * VIP 订单路由 —— 单核极限优化版（示意实现）
 */
import { Router, type Request, type Response } from 'express'
import { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

// 可用套餐（简化版）
const PLANS = [
  { id: 'basic', name: '基础会员', price: 19, durationDays: 30 },
  { id: 'pro', name: '高级会员', price: 49, durationDays: 90 },
  { id: 'lifetime', name: '终身会员', price: 299, durationDays: 365 * 100 },
]

router.get('/plans', authMiddleware, (_req: Request, res: Response): void => {
  res.json({ success: true, plans: PLANS })
})

router.post('/order', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { planId } = req.body as { planId?: string }
    const plan = PLANS.find((p) => p.id === planId)
    if (!plan) {
      res.status(400).json({ success: false, error: '套餐不存在' })
      return
    }

    const outTradeNo = `V${Date.now()}${userId}`
    stmtCache
      .get('INSERT INTO vip_orders (userId, planId, amount, outTradeNo, status, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, plan.id, plan.price, outTradeNo, 'pending', new Date().toISOString())

    res.json({ success: true, outTradeNo, amount: plan.price })
  } catch (error: any) {
    console.error('[vip-order]', error?.message || error)
    res.status(500).json({ success: false, error: '创建订单失败' })
  }
})

router.post('/pay', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { outTradeNo } = req.body as { outTradeNo?: string }
    if (!outTradeNo) {
      res.status(400).json({ success: false, error: '参数错误' })
      return
    }

    const order = stmtCache
      .get('SELECT * FROM vip_orders WHERE outTradeNo = ? AND userId = ?')
      .get(outTradeNo, userId) as any
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' })
      return
    }
    if (order.status === 'paid') {
      res.json({ success: true, message: '已支付' })
      return
    }

    const plan = PLANS.find((p) => p.id === order.planId)
    if (!plan) {
      res.status(400).json({ success: false, error: '套餐不存在' })
      return
    }

    const expiresAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString()

    stmtCache.get('UPDATE vip_orders SET status = ? WHERE id = ?').run('paid', order.id)
    stmtCache.get('UPDATE users SET vip = 1, vipExpiresAt = ? WHERE id = ?').run(expiresAt, userId)

    res.json({ success: true, message: '支付成功', expiresAt })
  } catch (error: any) {
    console.error('[vip-pay]', error?.message || error)
    res.status(500).json({ success: false, error: '支付失败' })
  }
})

export default router
