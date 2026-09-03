/**
 * AI 问答路由 —— 调用本地 Ollama 模型
 */
import { Router, type Request, type Response } from 'express'

const router = Router()

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const AI_MODEL = process.env.AI_MODEL || 'qwen2:0.5b'

const SYSTEM_PROMPT = `你是"屿岸"，一个友好、热心的AI助手。请用自然流畅的中文回复用户。回答风格：简洁直接，像朋友聊天一样自然，不要啰嗦。尽量保持回复在300字以内。`

// 对话历史存储（按会话ID，最多保留最近20轮）
const sessions = new Map<string, Array<{ role: string; content: string }>>()
const MAX_HISTORY = 20

/**
 * 检查服务状态
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json() as any
    const models = (data.models || []).map((m: any) => m.name)
    res.json({ success: true, model: AI_MODEL, local: true, models, message: '本地 AI 服务就绪' })
  } catch {
    res.json({ success: false, error: 'Ollama 服务未运行', local: true })
  }
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

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 800,
        },
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error('[ai] Ollama 错误:', response.status, errText.slice(0, 200))
      res.status(500).json({ success: false, error: `AI 服务返回错误 (${response.status})` })
      return
    }

    const data = await response.json() as any
    const reply = data?.message?.content || ''

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