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

// 备用服务器地址（Socket.io 连接）
const IPV6_SOCKET = 'http://[2409:8a50:1035:6d50:5228:73ff:fe48:f26f]:3001'
const IPV4_SOCKET = 'http://120.228.82.170:3001'

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
  let fallbackTried = false

  socket = io(url, {
    auth: { token },
    transports: ['polling', 'websocket'],
    upgrade: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.5,
    timeout: 20000,
  })

  socket.on('connect', () => {
    console.log('[socket] 已连接')
    startHeartbeat()
    reconnectListeners.forEach((fn) => fn())
  })

  socket.on('disconnect', (reason: string) => {
    console.log('[socket] 断开:', reason)
  })

  socket.on('connect_error', (error) => {
    console.log('[socket] 连接错误（自动重连中）:', error.message)
    // IPv6 失败 → 尝试 IPv4
    if (!fallbackTried && isNativeApp() && isAndroid() && url === IPV6_SOCKET) {
      fallbackTried = true
      console.log('[socket] IPv6 连接失败，尝试 IPv4...')
      socket?.disconnect()
      socket = io(IPV4_SOCKET, {
        auth: { token },
        transports: ['polling', 'websocket'],
        upgrade: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 15000,
        randomizationFactor: 0.5,
        timeout: 20000,
      })
      // 重新绑定事件
      socket.on('connect', () => {
        console.log('[socket] 已连接 (IPv4)')
        startHeartbeat()
        reconnectListeners.forEach((fn) => fn())
      })
      socket.on('disconnect', (reason: string) => {
        console.log('[socket] 断开:', reason)
      })
      socket.on('connect_error', (err) => {
        console.log('[socket] 连接错误:', err.message)
      })
      socket.on('reconnect', (attemptNumber: number) => {
        console.log(`[socket] 第 ${attemptNumber} 次尝试后重连成功`)
      })
    }
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
