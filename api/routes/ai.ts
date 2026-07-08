/**
 * AI 浏览器代理路由
 * Node.js <-> Python 服务通信
 */
import { Router, type Request, type Response } from 'express'
import fetch from 'node-fetch'
import { getIO } from '../socket.js'

const router = Router()

const AGENT_URL = process.env.BROWSER_AGENT_URL || 'http://localhost:3002'

/**
 * 检查服务状态
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const resp = await fetch(`${AGENT_URL}/health`)
    const data = await resp.json()
    res.json({ success: true, ...data })
  } catch (err: any) {
    res.json({ success: false, error: 'Python 服务未启动', details: err.message })
  }
})

/**
 * 获取任务列表
 */
router.get('/tasks', async (_req: Request, res: Response) => {
  try {
    const resp = await fetch(`${AGENT_URL}/tasks`)
    const data = await resp.json()
    res.json({ success: true, ...data })
  } catch (err: any) {
    res.json({ success: false, error: err.message })
  }
})

/**
 * 查询单个任务状态
 */
router.get('/task/:id', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id
    const resp = await fetch(`${AGENT_URL}/status/${taskId}`)
    const data = await resp.json()
    if (resp.status === 404) {
      res.json({ success: false, error: '任务不存在' })
      return
    }
    res.json({ success: true, ...data })
  } catch (err: any) {
    res.json({ success: false, error: err.message })
  }
})

/**
 * 提交新任务
 */
router.post('/submit', async (req: Request, res: Response) => {
  try {
    const { task, maxSteps, userId, source, targetId } = req.body

    if (!task || !task.trim()) {
      res.status(400).json({ success: false, error: '请输入任务描述' })
      return
    }

    const response = await fetch(`${AGENT_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: task,
        max_steps: maxSteps || 10,
        user_id: userId,
        source: source || 'chat',
        target_id: targetId,
      }),
    })

    const data = await response.json()

    if (!data.task_id) {
      res.status(500).json({ success: false, error: data.error || '提交失败' })
      return
    }

    // 通过 Socket.IO 广播任务提交事件
    const io = getIO()
    io.emit('ai_task_submitted', {
      taskId: data.task_id,
      task,
      userId,
      source,
      targetId,
      status: 'pending',
    })

    res.json({ success: true, ...data })
  } catch (err: any) {
    console.error('[ai/submit]', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * Python Agent 回调入口：任务完成后调用
 */
router.post('/callback', async (req: Request, res: Response) => {
  try {
    const { task_id: taskId, status, result } = req.body

    console.log(`[ai/callback] 任务 ${taskId} ${status}`)

    // 通过 Socket.IO 广播任务完成事件
    const io = getIO()
    io.emit('ai_task_complete', {
      taskId,
      status,
      result,
    })

    res.json({ success: true })
  } catch (err) {
    console.error('[ai/callback]', err)
    res.status(500).json({ success: false, error: String(err) })
  }
})

export default router
