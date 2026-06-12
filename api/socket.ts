/**
 * Socket.io 实时通信处理器
 */
import { Server as SocketIOServer } from 'socket.io'
import type { Server as HTTPServer } from 'http'
import jwt from 'jsonwebtoken'
import db from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'chat-secret-key-2024'

// 在线用户映射 userId -> socketId
const onlineUsers = new Map<number, string>()

let io: SocketIOServer

export function initSocket(server: HTTPServer) {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  })

  // Socket auth 中间件
  io.use((socket, next) => {
    const token = socket.handshake.auth.token
    if (!token) {
      return next(new Error('未提供认证令牌'))
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any
      socket.data.user = decoded
      next()
    } catch {
      next(new Error('令牌无效或已过期'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user as { id: number; username: string }
    console.log(`用户上线: ${user.username} (${user.id})`)

    // 记录在线状态
    onlineUsers.set(user.id, socket.id)

    // 通知好友该用户上线
    const friends = db.prepare(`
      SELECT friendId FROM friendships WHERE userId = ?
      UNION SELECT userId FROM friendships WHERE friendId = ?
    `).all(user.id, user.id) as any[]

    friends.forEach((f: any) => {
      const friendSocketId = onlineUsers.get(f.friendId)
      if (friendSocketId) {
        io.to(friendSocketId).emit('user_online', { userId: user.id, username: user.username })
      }
    })

    // 发送自己的在线状态给客户端
    socket.emit('online_users', Array.from(onlineUsers.keys()))

    // 处理发送消息
    socket.on('send_message', (data: { receiverId: number; content: string; type: string; fileUrl?: string }) => {
      try {
        const messageType = data.type || 'text'
        const fileUrl = data.fileUrl || ''

        // 检查接收者是否已注销
        const receiver = db.prepare('SELECT active FROM users WHERE id = ?').get(data.receiverId) as any
        if (!receiver || receiver.active === 0) {
          socket.emit('error', { message: '该用户已注销，无法发送消息' })
          return
        }

        // 保存消息到数据库
        const result = db.prepare(
          'INSERT INTO messages (senderId, receiverId, content, type, fileUrl) VALUES (?, ?, ?, ?, ?)'
        ).run(user.id, data.receiverId, data.content, messageType, fileUrl)

        const message = {
          id: result.lastInsertRowid,
          senderId: user.id,
          receiverId: data.receiverId,
          content: data.content,
          type: messageType,
          fileUrl,
          timestamp: new Date().toISOString(),
        }

        // 发送给接收者（如果在线）
        const receiverSocketId = onlineUsers.get(data.receiverId)
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('new_message', message)
        }

        // 发送回发送者确认
        socket.emit('new_message', message)
      } catch (error) {
        console.error('发送消息错误:', error)
        socket.emit('error', { message: '消息发送失败' })
      }
    })

    // 处理正在输入状态
    socket.on('typing', (data: { receiverId: number; isTyping: boolean }) => {
      const receiverSocketId = onlineUsers.get(data.receiverId)
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('typing_status', {
          userId: user.id,
          username: user.username,
          isTyping: data.isTyping,
        })
      }
    })

    // 处理断开连接
    socket.on('disconnect', () => {
      console.log(`用户下线: ${user.username} (${user.id})`)
      onlineUsers.delete(user.id)

      // 通知好友该用户下线
      friends.forEach((f: any) => {
        const friendSocketId = onlineUsers.get(f.friendId)
        if (friendSocketId) {
          io.to(friendSocketId).emit('user_offline', { userId: user.id, username: user.username })
        }
      })
    })
  })

  return io
}

export function getIO() {
  return io
}

export { onlineUsers }