/**
 * AI 助手路由 —— 单核极限优化版（简化实现：关键词回复）
 */
import { Router, type Request, type Response } from 'express'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

// 关键词回复规则
const RULES: { pattern: RegExp; reply: (m: RegExpMatchArray) => string }[] = [
  { pattern: /你好|您好|hello|hi/i, reply: () => '你好！有什么我可以帮你的？' },
  { pattern: /(几点|时间|now|time)/i, reply: () => `现在时间：${new Date().toLocaleString('zh-CN')}` },
  { pattern: /(天气|weather)/i, reply: () => '抱歉，我暂时无法查询实时天气。' },
  { pattern: /(好友|添加|朋友)/i, reply: () => '你可以在"搜索用户"中输入用户名添加好友，对方同意后即可开始聊天。' },
  { pattern: /(群|组)/i, reply: () => '你可以创建群聊，把好友邀请到群里一起聊天。' },
  { pattern: /(谢谢|感谢|thx|thanks)/i, reply: () => '不客气！' },
  { pattern: /再见|拜拜|goodbye|bye/i, reply: () => '再见！期待下次和你聊天。' },
]

router.post('/chat', authMiddleware, (req: Request, res: Response): void => {
  try {
    const { message } = req.body as { message?: string }
    if (!message || !String(message).trim()) {
      res.status(400).json({ success: false, error: '请输入消息' })
      return
    }

    const text = String(message).trim()
    for (const rule of RULES) {
      const m = text.match(rule.pattern)
      if (m) {
        res.json({ success: true, reply: rule.reply(m) })
        return
      }
    }

    // 默认回复
    res.json({ success: true, reply: `我收到了你的消息："${text.slice(0, 80)}"。目前我只能回复简单的关键词，还在学习中。` })
  } catch (error: any) {
    console.error('[ai-chat]', error?.message || error)
    res.status(500).json({ success: false, error: '对话失败' })
  }
})

export default router
