/**
 * Socket.io 客户端
 * - 支持浏览器 + Capacitor Android
 * - 心跳：每 10s 发一次 ping，刷新服务端在线 TTL
 * - 静默重连：断开后自动重连，不打扰用户
 * - 重连成功后自动拉取在线用户列表
 */
import { io, Socket } from 'socket.io-client'
import { getApiBaseUrl } from './api'
import { isAndroid, isNativeApp } from './platform'

let socket: Socket | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let reconnectListeners: Array<() => void> = [] // 外部可注册重连回调

function getSocketUrl(): string {
  if (isNativeApp() && isAndroid()) {
    const base = getApiBaseUrl()
    return base.replace(/\/api$/, '')
  }
  return '/'
}

function startHeartbeat() {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(() => {
    if (socket?.connected) {
      socket.emit('ping')
    }
  }, 10000) // 每 10s 一次心跳
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

export function connectSocket(token: string) {
  if (socket?.connected) return socket

  // 如果已有旧连接（断开中），先清理
  if (socket) {
    stopHeartbeat()
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }

  const url = getSocketUrl()

  socket = io(url, {
    auth: { token },
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionDelay: 1000,         // 首次重试等 1 秒
    reconnectionDelayMax: 15000,     // 最长 15 秒间隔
    randomizationFactor: 0.5,        // 增加随机因子防雪崩
    timeout: 20000,
  })

  socket.on('connect', () => {
    console.log('[socket] 已连接')
    startHeartbeat()
    // 重连成功时触发外部回调（例如刷新在线用户列表）
    reconnectListeners.forEach((fn) => fn())
  })

  socket.on('disconnect', (reason: string) => {
    console.log('[socket] 断开:', reason)
    // 注：不停止心跳，socket.io 的 reconnection 会自动重连
    // 如果是 "io client disconnect"（用户主动断开），心跳 timer 会在 disconnectSocket 中清理
  })

  socket.on('connect_error', (error) => {
    // 不向用户展示错误，静默继续重连
    console.log('[socket] 连接错误（自动重连中）:', error.message)
  })

  socket.on('reconnect', (attemptNumber: number) => {
    console.log(`[socket] 第 ${attemptNumber} 次尝试后重连成功`)
  })

  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  stopHeartbeat()
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

/** 注册重连回调（例如重连成功后刷新在线用户列表） */
export function onReconnect(fn: () => void) {
  reconnectListeners.push(fn)
}

export function clearReconnectListeners() {
  reconnectListeners = []
}
