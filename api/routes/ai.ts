/**
 * AI 助手路由 —— DeepSeek API + 对话记忆 + 智能兜底
 */
import { Router, type Request, type Response } from 'express'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'

// 对话记忆（最多保留每用户最近10轮）
const historyMap = new Map<number, Array<{ role: string; content: string }>>()

function getHistory(userId: number): Array<{ role: string; content: string }> {
  if (!historyMap.has(userId)) historyMap.set(userId, [])
  return historyMap.get(userId)!
}

function addHistory(userId: number, role: string, content: string) {
  const h = getHistory(userId)
  h.push({ role, content })
  if (h.length > 20) h.splice(0, 2) // 保留最近10轮（20条）
}

// 智能兜底（DeepSeek 不可用时）
const RESPONSES: Record<string, string[]> = {
  greet: [
    '你好呀！很高兴认识你 😊', '嗨！有什么我可以帮你的吗？', '你好！我是屿岸AI助手，随时为你服务！',
  ],
  thanks: ['不客气！😊', '很高兴能帮到你！', '不用谢，有问题随时问我~'],
  bye: ['再见！期待下次和你聊天~', '拜拜！祝你有美好的一天！', '下次见啦！👋'],
  help: [
    'ChatRoom 使用指南：\n• 好友页面搜索用户名添加好友\n• 好友页面可创建群聊\n• 底部【动态】查看朋友圈\n• 底部【我的】修改个人资料\n还有什么想了解的？',
  ],
  who: ['我是屿岸AI助手，ChatRoom 内置的智能聊天伙伴！有什么问题都可以问我~'],
  joke: [
    '程序员的幽默：为什么程序员总是分不清万圣节和圣诞节？因为 Oct 31 = Dec 25 😄',
    '问：程序员最讨厌康熙的哪个儿子？答：胤禩，因为他是八阿哥（bug）😂',
    '为什么 Java 程序员总戴眼镜？因为他们看不到 C# 😎',
  ],
  default: [
    '我明白啦！有什么关于 ChatRoom 使用的问题都可以问我哦~',
    '嗯嗯，收到！如果你有任何使用问题（加好友、建群、发动态等），随时告诉我！',
    '了解！你也可以试试问我"你能做什么"来查看我的功能列表 😊',
    '好的！我是屿岸AI助手，可以陪你聊天、解答问题，尽管问吧~',
  ],
}

function matchKeyword(text: string): string | null {
  const t = text.toLowerCase()
  if (/(你好|您好|hello|hi|嗨|哈喽|早上好|中午好|下午好|晚上好|晚安)/i.test(t)) return pick(RESPONSES.greet)
  if (/(几点|时间|现在几点|what time|now)/i.test(t)) return `现在是 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
  if (/(几号|日期|今天|星期|周几|date|today)/i.test(t)) {
    const now = new Date(); const weeks = ['日', '一', '二', '三', '四', '五', '六']
    return `今天是 ${now.toLocaleDateString('zh-CN')}，星期${weeks[now.getDay()]}`
  }
  if (/(天气|weather|下雨|晴天|温度|气温)/i.test(t)) return '抱歉，我暂时无法查询实时天气。你可以查看手机上的天气APP哦！'
  if (/(怎么加好友|添加好友|加朋友|好友功能)/i.test(t)) return '在"好友"页面点击"搜索用户"，输入用户名就能找到对方，发送好友申请等待同意就可以啦！'
  if (/(怎么建群|创建群聊|群功能|群聊|怎么加群)/i.test(t)) return '在"好友"页面点击"创建群聊"，选择要邀请的好友，就能一起群聊啦！'
  if (/(朋友圈|动态|发动态|发朋友圈)/i.test(t)) return '点击底部导航的"动态"就能进入朋友圈，在广场栏点击右上角可以发布新动态哦！'
  if (/(怎么换头像|改头像|修改资料|改昵称|修改密码)/i.test(t)) return '进入底部"我的"页面（设置），就可以修改头像、昵称、个人简介和密码哦！'
  if (/(vip|会员|特权)/i.test(t)) return 'VIP会员享受专属金色昵称标识、更大文件上传、专属表情等特权！在"我的"页面可以查看VIP套餐。'
  if (/(谢谢|感谢|thx|thanks|多谢|谢啦)/i.test(t)) return pick(RESPONSES.thanks)
  if (/(再见|拜拜|goodbye|bye)/i.test(t)) return pick(RESPONSES.bye)
  if (/(你是谁|你叫什么|who are you)/i.test(t)) return pick(RESPONSES.who)
  if (/(你能做什么|你会什么|功能|帮助|怎么用)/i.test(t)) return pick(RESPONSES.help)
  if (/(笑话|joke|讲个笑话|搞笑)/i.test(t)) return pick(RESPONSES.joke)
  if (/(开心|高兴|快乐|哈哈|嘻嘻)/i.test(t)) return '看到你开心我也很开心！😄'
  if (/(难过|伤心|不开心|郁闷|烦)/i.test(t)) return '别难过啦~ 和朋友聊聊天、看看朋友圈，心情会好起来的！💪'
  return null
}

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]
}

async function callDeepSeek(userId: number, message: string): Promise<string | null> {
  try {
    const history = getHistory(userId)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)

    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `你是ChatRoom的屿岸AI助手，一个温暖、有趣的智能聊天伙伴。

关于 ChatRoom 的功能：
- 一对一私聊、群聊（可在好友页面创建）
- 好友系统：搜索用户名添加好友，支持好友请求
- 朋友圈（动态）：发布动态、评论，支持图片
- 官方账号 ChatRoom 定期发布官方动态
- VIP会员：金色昵称、更大文件上传等特权
- 个人设置：修改头像、昵称、密码等

回答规则：
- 用中文，自然亲切，像朋友一样
- 回答简洁，2-4句话为宜，不要长篇大论
- 适当使用 emoji 让对话更生动
- 不确定的问题诚实说不知道，不要编造
- 涉及 ChatRoom 功能的问题要准确回答`,
          },
          ...history,
          { role: 'user', content: message },
        ],
        temperature: 0.8,
        max_tokens: 600,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      console.error('[deepseek] HTTP', res.status)
      return null
    }

    const data = await res.json() as any
    const reply = data?.choices?.[0]?.message?.content
    if (reply) {
      addHistory(userId, 'user', message)
      addHistory(userId, 'assistant', reply)
      return reply
    }
    return null
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error('[deepseek] timeout')
    } else {
      console.error('[deepseek]', err?.message || err)
    }
    return null
  }
}

router.post('/chat', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user.id
    const { message } = req.body as { message?: string }

    if (!message || !String(message).trim()) {
      res.status(400).json({ success: false, error: '请输入消息' })
      return
    }

    const text = String(message).trim()

    // 优先使用 DeepSeek API
    const deepseekReply = await callDeepSeek(userId, text)
    if (deepseekReply) {
      res.json({ success: true, reply: deepseekReply })
      return
    }

    // 兜底：关键词匹配
    const kwReply = matchKeyword(text)
    if (kwReply) {
      res.json({ success: true, reply: kwReply })
      return
    }

    // 最终兜底
    res.json({ success: true, reply: pick(RESPONSES.default) })
  } catch (error: any) {
    console.error('[ai-chat]', error?.message || error)
    res.status(500).json({ success: false, error: '对话失败' })
  }
})

export default router