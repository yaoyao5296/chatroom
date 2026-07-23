/**
 * 错误上报路由
 * 接收客户端错误报告，记录日志，严重时自动停服
 */
import { Router, type Request, type Response } from 'express'
import { getIO } from '../socket.js'

const router = Router()

// 内存中保留最近 100 条错误
const errorHistory: Array<{
  id: number
  type: string
  message: string
  stack?: string
  url: string
  timestamp: number
  userAgent: string
}> = []

let errorIdCounter = 0

// 错误统计（每分钟重置）
let errorCountMinute = 0
let errorMinuteTimer = Date.now()

// 紧急停服标记
export let emergencyShutdown = false
let shutdownTriggered = false

// 服务状态：供客户端查询
export let serviceStatus: 'normal' | 'degraded' | 'emergency' = 'normal'
export let serviceStatusMessage = ''

export function setServiceStatus(status: 'normal' | 'degraded' | 'emergency', message: string = ''): void {
  serviceStatus = status
  serviceStatusMessage = message
}

/**
 * 触发紧急停服（由外部调用）
 */
export function triggerEmergencyShutdown(reason: string): void {
  if (shutdownTriggered) return
  shutdownTriggered = true
  emergencyShutdown = true
  setServiceStatus('emergency', reason)

  console.error(`[紧急停服] ${reason}`)

  try {
    const io = getIO()
    if (io) {
      io.emit('service_error', {
        type: 'emergency_shutdown',
        message: '服务出错，正在修复',
        detail: reason,
        timestamp: Date.now(),
      })
      console.log('[紧急停服] 已通知所有在线用户')
    }
  } catch {}

  console.log('[紧急停服] 3 秒后退出...')
  setTimeout(() => {
    console.log('[紧急停服] 执行退出')
    process.exit(1)
  }, 3000)
}

router.post('/report', (req: Request, res: Response) => {
  const { type, message, stack, url, timestamp, userAgent } = req.body

  if (!message) {
    res.status(400).json({ success: false, error: '缺少错误信息' })
    return
  }

  const now = Date.now()

  // 重置每分钟计数
  if (now - errorMinuteTimer > 60000) {
    errorMinuteTimer = now
    errorCountMinute = 0
  }
  errorCountMinute++

  const entry = {
    id: ++errorIdCounter,
    type: type || 'unknown',
    message: String(message).slice(0, 500),
    stack: stack ? String(stack).slice(0, 2000) : undefined,
    url: url || '',
    timestamp: timestamp || now,
    userAgent: userAgent || '',
  }

  // 保留最近 100 条
  errorHistory.push(entry)
  if (errorHistory.length > 100) {
    errorHistory.shift()
  }

  // 日志输出
  const prefix = type === 'unhandledrejection' ? '[未处理的Promise]' :
    type === 'console' ? '[console.error]' : '[客户端错误]'
  console.error(`${prefix} ${message}`)
  if (stack) {
    console.error(`  ${stack.split('\n').slice(0, 3).join('\n  ')}`)
  }

  // 错误激增告警
  if (errorCountMinute >= 5 && errorCountMinute < 10) {
    setServiceStatus('degraded', '客户端错误激增')
    const io = getIO()
    io.emit('system_alert', {
      type: 'error_spike',
      message: `客户端错误激增：${errorCountMinute} 次/分钟`,
      detail: `最近错误: ${message.slice(0, 100)}`,
      timestamp: now,
    })
  }

  // 严重错误 → 紧急停服
  if (errorCountMinute >= 10 && !shutdownTriggered) {
    triggerEmergencyShutdown(`客户端错误频率过高 (${errorCountMinute} 次/分钟)，最近: ${message.slice(0, 80)}`)
  }

  res.json({ success: true })
})

// 查询最近错误
router.get('/recent', (_req: Request, res: Response) => {
  const limit = Math.min(Number(_req.query.limit) || 20, 100)
  res.json({
    success: true,
    total: errorHistory.length,
    errors: errorHistory.slice(-limit).reverse(),
  })
})

// 清除错误记录
router.delete('/clear', (_req: Request, res: Response) => {
  errorHistory.length = 0
  errorCountMinute = 0
  serviceStatus = 'normal'
  serviceStatusMessage = ''
  res.json({ success: true, message: '已清除' })
})

// 查询服务状态
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: serviceStatus,
    message: serviceStatusMessage,
    emergency: emergencyShutdown,
  })
})

export default router