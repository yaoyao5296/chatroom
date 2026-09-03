/**
 * AI 问答路由 —— 调用本地 Ollama 模型 + 联网搜索
 */
import { Router, type Request, type Response } from 'express'
import * as cheerio from 'cheerio'

const router = Router()

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
const AI_MODEL = process.env.AI_MODEL || 'qwen2.5:1.5b'
const SEARCH_TIMEOUT = 8000

const SYSTEM_PROMPT = `你是"屿岸"，一个友好、热心的AI助手。你有联网搜索能力，当用户需要最新信息时，你会参考搜索结果来回答。

回答规则：
- 用自然流畅的中文回复
- 如果参考了搜索结果，在回答末尾注明来源链接
- 简洁直接，像朋友聊天一样自然
- 尽量控制在300字以内
- 如果搜索结果不足以回答，如实告诉用户`

// 对话历史存储（按会话ID，最多保留最近20轮）
const sessions = new Map<string, Array<{ role: string; content: string }>>()
const MAX_HISTORY = 20

/**
 * DuckDuckGo / Bing 网页搜索（无需 API Key）
 * 多引擎轮替，提高可用性
 */
async function webSearch(query: string): Promise<string> {
  const results: string[] = []
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

  // ---------- 方案1: DuckDuckGo HTML ----------
  async function tryDuckDuckGo(): Promise<boolean> {
    try {
      const r = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(SEARCH_TIMEOUT) },
      )
      if (!r.ok) return false
      const html = await r.text()
      if (html.includes('Challenge') || html.includes('verify')) return false
      const $ = cheerio.load(html)
      let n = 0
      $('.result').each((_, el) => {
        if (n >= 6) return
        const title = $(el).find('.result__title a').text().trim()
        const snippet = $(el).find('.result__snippet').text().trim()
        const url = $(el).find('.result__url').text().trim() || $(el).find('.result__title a').attr('href') || ''
        if (title && snippet) { results.push(`[${title}](${url})\n${snippet}`); n++ }
      })
      return n > 0
    } catch { return false }
  }

  // ---------- 方案2: Bing 搜索 ----------
  async function tryBing(): Promise<boolean> {
    try {
      const r = await fetch(
        `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=zh-CN`,
        {
          headers: {
            'User-Agent': UA,
            'Accept': 'text/html',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Accept-Encoding': 'gzip',
          },
          signal: AbortSignal.timeout(SEARCH_TIMEOUT),
        },
      )
      if (!r.ok) return false
      const html = await r.text()
      const $ = cheerio.load(html)
      let n = 0
      $('li.b_algo').each((_, el) => {
        if (n >= 6) return
        const title = $(el).find('h2').text().trim()
        const snippet = $(el).find('.b_caption .b_lineclamp2, .b_caption p').text().trim()
        const url = $(el).find('h2 a').attr('href') || ''
        if (title && snippet && snippet.length > 10) { results.push(`[${title}](${url})\n${snippet}`); n++ }
      })
      // 捞不到就捞所有 h2 链接
      if (n === 0) {
        $('h2 a').each((_, el) => {
          if (n >= 6) return
          const t = $(el).text().trim()
          const h = $(el).attr('href') || ''
          if (t && h.startsWith('http')) { results.push(`${t}: ${h}`); n++ }
        })
      }
      return n > 0
    } catch { return false }
  }

  // 按顺序尝试
  if (await tryDuckDuckGo()) { /* ok */ }
  else if (await tryBing()) { console.log('[ai/search] 使用 Bing 搜索'); /* ok */ }
  else {
    // 最后尝试：DuckDuckGo 精简版
    try {
      const r = await fetch(
        `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(SEARCH_TIMEOUT) },
      )
      if (r.ok) {
        const html = await r.text()
        const $ = cheerio.load(html)
        let n = 0
        $('a[href^="http"]').each((_, el) => {
          if (n >= 6) return
          const t = $(el).text().trim()
          const h = $(el).attr('href') || ''
          if (t && t.length > 10 && !h.includes('duckduckgo.com')) { results.push(`${t}: ${h}`); n++ }
        })
      }
    } catch { /* ignore */ }
  }

  const top = results.slice(0, 6)
  if (top.length === 0) return '[未找到相关搜索结果]'
  return top.join('\n\n')
}

/**
 * 判断是否需要搜索
 */
function needsSearch(message: string): boolean {
  const kw = [
    '搜索', '查一下', '查一查', '找一下', '搜索一下',
    '最新', '今天', '现在', '目前', '最近',
    '新闻', '天气', '股票', '汇率', '价格',
    'search', 'google', 'what is', 'who is', 'how to',
    'news', 'weather', 'stock', 'price',
  ]
  const msg = message.toLowerCase()
  return kw.some(k => msg.includes(k))
}

/**
 * 检查服务状态
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json() as any
    const models = (data.models || []).map((m: any) => m.name)
    res.json({ success: true, model: AI_MODEL, local: true, search: true, models, message: '本地 AI 服务就绪，支持联网搜索' })
  } catch {
    res.json({ success: false, error: 'Ollama 服务未运行', local: true, search: true })
  }
})

/**
 * 发送消息，获取 AI 回复
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, history, sessionId, search: forceSearch } = req.body

    if (!message || !message.trim()) {
      res.status(400).json({ success: false, error: '请输入消息' })
      return
    }

    const sid = sessionId || 'default'
    const shouldSearch = forceSearch !== false && (forceSearch === true || needsSearch(message))

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

    // 如果需要搜索，先搜索再拼接消息
    let userMsg = message.trim()
    if (shouldSearch) {
      console.log(`[ai] 联网搜索: ${message.slice(0, 50)}...`)
      const searchResult = await webSearch(message)
      console.log(`[ai] 搜索结果: ${searchResult.slice(0, 100)}...`)

      // 搜索结果作为上下文注入
      userMsg = `用户问题：${message.trim()}\n\n【联网搜索结果】\n${searchResult}\n\n请根据以上搜索结果回答用户问题。如果搜索结果与问题无关，请直接用自己的知识回答。`
    }

    messages.push({ role: 'user', content: userMsg })

    console.log(`[ai] 处理消息: ${message.slice(0, 50)}...`)

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 1200,
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

    res.json({ success: true, reply, searched: shouldSearch })
  } catch (err: any) {
    console.error('[ai/chat]', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

export default router