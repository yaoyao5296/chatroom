/**
 * Socket.io 客户端
 */
import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export function connectSocket(token: string) {
  if (socket?.connected) {
    return socket
  }

  // 使用 polling 传输避免预览环境 WebSocket 代理问题
  socket = io('/', {
    auth: { token },
    transports: ['polling'],
    upgrade: false,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
  })

  socket.on('connect_error', (error) => {
    console.error('Socket 连接失败，使用轮询模式:', error.message)
  })

  socket.on('connect', () => {
    console.log('Socket 已连接')
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  })

  return socket
}

export function getSocket() {
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}