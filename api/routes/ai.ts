/**
 * AI 问答路由 —— 直接调用 GitHub Models API
 * 使用 Node 18+ 内置 fetch（无需 node-fetch）
 */
import { Router, type Request, type Response } from 'express'

const router = Router()

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini'
const API_URL = 'https://models.inference.ai.azure.com/chat/completions'

const SYSTEM_PROMPT = `你是"屿岸"，一个友好、热心的AI助手。请用自然流畅的中文回复用户。回答风格：简洁直接，像朋友聊天一样自然，不要啰嗦。尽量保持回复在300字以内。`

// 对话历史存储（按会话ID，最多保留最近20轮）
const sessions = new Map<string, Array<{ role: string; content: string }>>()
const MAX_HISTORY = 20

/**
 * 检查服务状态
 */
router.get('/status', (_req: Request, res: Response) => {
  if (!GITHUB_TOKEN) {
    res.json({ success: false, error: 'GITHUB_TOKEN 未配置' })
    return
  }
  res.json({ success: true, model: AI_MODEL, message: 'AI 服务就绪' })
})

/**
 * 发送消息，获取 AI 回复
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, history, sessionId } = req.body

    if (!message || !message.trim()) {
      res.status(400).json({ success: false, error: '请输入消息' })
      return
    }

    if (!GITHUB_TOKEN) {
      res.status(500).json({ success: false, error: 'AI 服务未配置（缺少 GITHUB_TOKEN）' })
      return
    }

    const sid = sessionId || 'default'

    // 构建消息列表
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
    ]

    // 使用传入的 history 或服务端 session
    const chatHistory = (history && history.length > 0) ? history : (sessions.get(sid) || [])
    for (const h of chatHistory.slice(-MAX_HISTORY)) {
      if (h.role === 'user' || h.role === 'assistant' || h.role === 'system') {
        messages.push({ role: h.role, content: h.content })
      }
    }
    messages.push({ role: 'user', content: message.trim() })

    console.log(`[ai] 收到消息: ${message.trim().slice(0, 50)}...`)

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 800,
      }),
      timeout: 60000,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error('[ai] API 错误:', response.status, errText.slice(0, 200))
      res.status(500).json({ success: false, error: `AI 服务返回错误 (${response.status})` })
      return
    }

    const data = await response.json() as any
    const reply = data?.choices?.[0]?.message?.content || ''

    if (!reply) {
      res.status(500).json({ success: false, error: 'AI 未返回有效回复' })
      return
    }

    console.log(`[ai] 回复: ${reply.slice(0, 80)}...`)

    // 保存会话历史
    if (!sessions.has(sid)) {
      sessions.set(sid, [])
    }
    const sessionHistory = sessions.get(sid)!
    sessionHistory.push({ role: 'user', content: message.trim() })
    sessionHistory.push({ role: 'assistant', content: reply })
    if (sessionHistory.length > MAX_HISTORY * 2) {
      sessions.set(sid, sessionHistory.slice(-MAX_HISTORY * 2))
    }

    res.json({ success: true, reply })
  } catch (err: any) {
    console.error('[ai/chat]', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

export default router