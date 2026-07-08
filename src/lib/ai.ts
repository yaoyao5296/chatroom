/**
 * 屿岸 浏览器代理客户端
 * 管理 AI 任务提交、状态查询、结果展示
 */
import { getSocket } from './socket'

export interface AITask {
  taskId: string
  task: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  result?: string
  error?: string
  userId?: number
  username?: string
  source?: string
  targetId?: string
  createdAt?: number
}

// 任务列表
let tasks: AITask[] = []

// 回调列表
type TaskCallback = (task: AITask) => void
const callbacks: TaskCallback[] = []

export function onAITaskUpdate(cb: TaskCallback) {
  callbacks.push(cb)
  return () => {
    const idx = callbacks.indexOf(cb)
    if (idx >= 0) callbacks.splice(idx, 1)
  }
}

function notify(task: AITask) {
  // 更新或添加任务
  const idx = tasks.findIndex((t) => t.taskId === task.taskId)
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx], ...task }
  } else {
    tasks.push(task)
  }
  callbacks.forEach((cb) => cb(task))
}

export function getAITasks(): AITask[] {
  return tasks
}

export function clearAITasks(): void {
  tasks = []
}

/**
 * 提交 AI 任务
 */
export async function submitAITask(options: {
  task: string
  maxSteps?: number
  source?: 'chat' | 'group' | 'auto' | 'panel'
  targetId?: string
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  try {
    const sock = getSocket()
    if (sock?.connected) {
      // 通过 Socket 提交（实时反馈）
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ success: false, error: '提交超时' })
        }, 10000)

        sock.once('ai_task_submitted', (data: any) => {
          clearTimeout(timeout)
          if (data.taskId) {
            notify({
              taskId: data.taskId,
              task: options.task,
              status: 'pending',
              source: options.source || 'panel',
              createdAt: Date.now(),
            })
            resolve({ success: true, taskId: data.taskId })
          } else {
            resolve({ success: false, error: data.error || '提交失败' })
          }
        })

        sock.once('error', (err: any) => {
          clearTimeout(timeout)
          resolve({ success: false, error: err.message || '服务出错' })
        })

        sock.emit('ai_submit_task', {
          task: options.task,
          maxSteps: options.maxSteps || 10,
          source: options.source || 'panel',
          targetId: options.targetId || '',
        })
      })
    }

    // HTTP 降级
    const resp = await fetch('/api/ai/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: options.task,
        maxSteps: options.maxSteps || 10,
        source: options.source || 'panel',
        targetId: options.targetId || '',
      }),
    })
    const data = await resp.json()
    if (data.success && data.task_id) {
      notify({
        taskId: data.task_id,
        task: options.task,
        status: 'pending',
        source: options.source || 'panel',
        createdAt: Date.now(),
      })
      return { success: true, taskId: data.task_id }
    }
    return { success: false, error: data.error }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * 查询任务状态
 */
export async function queryTaskStatus(taskId: string): Promise<AITask | null> {
  try {
    const resp = await fetch(`/api/ai/task/${taskId}`)
    const data = await resp.json()
    if (data.success) {
      const task: AITask = {
        taskId,
        task: '',
        status: data.status,
        result: data.result,
        error: data.error,
      }
      notify(task)
      return task
    }
    return null
  } catch {
    return null
  }
}

/**
 * 检查 AI 服务状态
 */
export async function checkAIStatus(): Promise<{ online: boolean; tasksCount?: number }> {
  try {
    const resp = await fetch('/api/ai/status')
    const data = await resp.json()
    return { online: data.success, tasksCount: data.tasks_count }
  } catch {
    return { online: false }
  }
}

/**
 * 初始化 Socket 监听
 */
export function initAISocket(): () => void {
  const sock = getSocket()
  if (!sock) return () => {}

  const onSubmitted = (data: any) => {
    notify({
      taskId: data.taskId,
      task: data.task || '',
      status: data.status || 'pending',
      userId: data.userId,
      username: data.username,
      source: data.source,
      targetId: data.targetId,
      createdAt: Date.now(),
    })
  }

  const onComplete = (data: any) => {
    notify({
      taskId: data.taskId,
      task: '',
      status: data.status,
      result: data.result,
    })
  }

  sock.on('ai_task_submitted', onSubmitted)
  sock.on('ai_task_complete', onComplete)

  return () => {
    sock.off('ai_task_submitted', onSubmitted)
    sock.off('ai_task_complete', onComplete)
  }
}