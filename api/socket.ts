/**
 * Socket.io 实时通信处理器
 * 
 * 关键改造：崩溃无感恢复 + 在线人数不变
 * - 在线用户存储在 Redis（或内存降级）
 * - 用户断线后进入 20s 宽限期，在此期间重连不算下线
 * - 前端每 10s 心跳，刷新在线 TTL
 * - 崩溃重启后从 Redis 恢复在线状态，不影响用户
 */
import { Server as SocketIOServer } from 'socket.io'
import type { Server as HTTPServer } from 'http'
import jwt from 'jsonwebtoken'
import db from './db.js'
import {
  markOnline,
  isInGracePeriod,
  scheduleOffline,
  getUserSocketId,
  getAllOnlineUserIds,
  getOnlineCount,
  heartbeat,
  setActiveSession,
  getActiveSession,
  startOnlineCleanup,
} from './redis.js'

const JWT_SECRET = process.env.JWT_SECRET || 'chat-secret-key-2024'

// 当前进程中建立的 socketId -> socket 映射（用于定向发送消息）
// 注：多实例部署时，同一个用户可能连到不同的实例，此时需要 Redis Pub/Sub 广播
// 这里先做单机版，未来扩展到多实例时再加 Redis 广播
const localSockets = new Map<string, { socket: any; userId: number; username: string }>()

function incrementUnreadCount(userId: number, targetType: 'friend' | 'group', targetId: number, message: string, senderId: number) {
  // 判断用户是否正在查看该会话（不增加未读）
  getActiveSession(userId).then((activeSession) => {
    const sessionKey = `${targetType}:${targetId}`
    if (activeSession === sessionKey) {
      return
    }

    const existing = db.prepare(
      'SELECT id FROM unread_counts WHERE userId = ? AND targetType = ? AND targetId = ?'
    ).get(userId, targetType, targetId) as any

    if (existing) {
      db.prepare(
        'UPDATE unread_counts SET count = count + 1, lastMessage = ?, lastSenderId = ?, lastTimestamp = ? WHERE id = ?'
      ).run(message.slice(0, 100), senderId, new Date().toISOString(), existing.id)
    } else {
      db.prepare(
        'INSERT INTO unread_counts (userId, targetType, targetId, count, lastMessage, lastSenderId, lastTimestamp) VALUES (?, ?, ?, 1, ?, ?, ?)'
      ).run(userId, targetType, targetId, message.slice(0, 100), senderId, new Date().toISOString())
    }
  })
}

let io: SocketIOServer

/** 通过 userId 找到本地 socket 并发送消息（单机版） */
function emitToUser(userId: number, event: string, data: any): void {
  // 先查本地缓存（优先）
  for (const [sid, info] of localSockets.entries()) {
    if (info.userId === userId) {
      io.to(sid).emit(event, data)
      return
    }
  }
  // 本地找不到 → 查 Redis（可能用户之前连到了本实例但 socket 刚刚建立？）
  // 简化：Redis 只存状态，不在进程内的 socket 无法推送
  // 多实例场景下需要改用 Redis Pub/Sub 广播
}

/** 广播给该用户的好友（仅发 user_online/offline） */
function broadcastToFriends(me: { id: number; username: string }, event: string, payload: any): void {
  const friends = db.prepare(`
    SELECT friendId FROM friendships WHERE userId = ?
    UNION SELECT userId FROM friendships WHERE friendId = ?
  `).all(me.id, me.id) as any[]

  friends.forEach((f: any) => {
    for (const [sid, info] of localSockets.entries()) {
      if (info.userId === f.friendId) {
        io.to(sid).emit(event, payload)
      }
    }
  })
}

export function initSocket(server: HTTPServer) {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    // 支持 polling 降级，防止某些环境下 websocket 被拦截
    transports: ['polling', 'websocket'],
    pingInterval: 10000,
    pingTimeout: 5000,
  })

  // 启动后台清理任务（每 60s 清理过期在线用户）
  startOnlineCleanup()

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

    // 记录本地 socket 映射（用于定向发送）
    localSockets.set(socket.id, { socket, userId: user.id, username: user.username })

    // 先检查是否在宽限期内——如果 20s 内重新连接，视为"静默重连"，不广播上下线
    isInGracePeriod(user.id).then((inGrace) => {
      // 刷新在线状态
      markOnline(user.id, socket.id)

      if (!inGrace) {
        // 真正的新上线 → 广播给好友
        console.log(`[上线] ${user.username} (${user.id})`)
        broadcastToFriends(user, 'user_online', { userId: user.id, username: user.username })
      } else {
        // 静默重连（崩溃重启/网络抖动），不打扰好友
        console.log(`[重连] ${user.username} (${user.id}) 在宽限期内恢复`)
      }

      // 发给自己当前在线用户列表（用于前端显示）
      getAllOnlineUserIds().then((ids) => {
        socket.emit('online_users', ids)
      })
    })

    // 前端心跳（每 10s 发一次 ping，刷新 TTL）
    socket.on('ping', () => {
      heartbeat(user.id, socket.id)
      socket.emit('pong', Date.now())
    })

    socket.on('send_message', (data: { receiverId: number; content: string; type: string; fileUrl?: string }) => {
      try {
        const messageType = data.type || 'text'
        const fileUrl = data.fileUrl || ''

        if (data.receiverId !== user.id) {
          const receiver = db.prepare('SELECT active FROM users WHERE id = ?').get(data.receiverId) as any
          if (!receiver || receiver.active === 0) {
            socket.emit('error', { message: '该用户已注销，无法发送消息' })
            return
          }
        }

        const now = new Date().toISOString()
        const result = db.prepare(
          'INSERT INTO messages (senderId, receiverId, content, type, fileUrl, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(user.id, data.receiverId, data.content, messageType, fileUrl, now)

        const message = {
          id: result.lastInsertRowid,
          senderId: user.id,
          receiverId: data.receiverId,
          content: data.content,
          type: messageType,
          fileUrl,
          timestamp: now,
        }

        // 发送给接收者
        if (data.receiverId !== user.id) {
          // 找本地 socket（优先）
          let found = false
          for (const [sid, info] of localSockets.entries()) {
            if (info.userId === data.receiverId) {
              io.to(sid).emit('new_message', message)
              io.to(sid).emit('unread_updated', { targetType: 'friend', targetId: user.id })
              found = true
              break
            }
          }
          if (!found) {
            // 查 Redis（多实例场景下用户可能连到其他实例）
            getUserSocketId(data.receiverId).then((remoteSid) => {
              if (remoteSid) {
                // 未来接入 Redis Pub/Sub 后再广播
                // 目前单机部署模式下这里一般不会命中
              }
            })
          }

          incrementUnreadCount(data.receiverId, 'friend', user.id, data.content, user.id)
        }

        socket.emit('new_message', message)
      } catch (error) {
        console.error('发送消息错误:', error)
        socket.emit('error', { message: '消息发送失败' })
      }
    })

    socket.on('typing', (data: { receiverId: number; isTyping: boolean }) => {
      if (data.receiverId === user.id) return
      for (const [sid, info] of localSockets.entries()) {
        if (info.userId === data.receiverId) {
          io.to(sid).emit('typing_status', {
            userId: user.id,
            username: user.username,
            isTyping: data.isTyping,
          })
          break
        }
      }
    })

    socket.on('new_post', (post: any) => {
      socket.broadcast.emit('new_post', post)
    })

    socket.on('new_comment', (data: { comment: any; postId: number }) => {
      socket.broadcast.emit('new_comment', data)
    })

    socket.on('post_deleted', (postId: number) => {
      socket.broadcast.emit('post_deleted', postId)
    })

    socket.on('active_session', (data: { targetType: 'friend' | 'group'; targetId: number } | null) => {
      if (data) {
        setActiveSession(user.id, `${data.targetType}:${data.targetId}`)
      } else {
        setActiveSession(user.id, null)
      }
    })

    socket.on('send_group_message', (data: { groupId: number; content: string; type: string; fileUrl?: string }) => {
      try {
        const messageType = data.type || 'text'
        const fileUrl = data.fileUrl || ''
        const now = new Date().toISOString()

        const member = db.prepare(
          'SELECT id FROM group_members WHERE groupId = ? AND userId = ?'
        ).get(data.groupId, user.id)
        if (!member) {
          socket.emit('error', { message: '你不是该群成员' })
          return
        }

        const result = db.prepare(
          'INSERT INTO group_messages (groupId, senderId, content, type, fileUrl, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(data.groupId, user.id, data.content, messageType, fileUrl, now)

        const message = {
          id: result.lastInsertRowid,
          groupId: data.groupId,
          senderId: user.id,
          senderName: user.username,
          senderAvatar: '',
          content: data.content,
          type: messageType,
          fileUrl,
          timestamp: now,
        }

        const members = db.prepare(
          'SELECT userId FROM group_members WHERE groupId = ? AND userId != ?'
        ).all(data.groupId, user.id) as any[]

        members.forEach((m: any) => {
          const preview = `${user.username}: ${data.content}`
          incrementUnreadCount(m.userId, 'group', data.groupId, preview, user.id)
          for (const [sid, info] of localSockets.entries()) {
            if (info.userId === m.userId) {
              io.to(sid).emit('new_group_message', message)
              io.to(sid).emit('unread_updated', { targetType: 'group', targetId: data.groupId })
              break
            }
          }
        })

        socket.emit('new_group_message', message)
      } catch (error) {
        console.error('发送群消息错误:', error)
        socket.emit('error', { message: '群消息发送失败' })
      }
    })

    // 客户端主动请求在线人数（页面首次加载或恢复时）
    socket.on('get_online_count', async () => {
      const count = await getOnlineCount()
      socket.emit('online_count', count)
    })

    // 断开连接：进入 20s 宽限期
    socket.on('disconnect', () => {
      const info = localSockets.get(socket.id)
      if (info) {
        localSockets.delete(socket.id)
        // 进入宽限期（若 20s 内从其他 socket 重连则不广播下线）
        scheduleOffline(user.id, socket.id, user.username, (offUserId, offUsername) => {
          // 真正下线
          console.log(`[下线] ${offUsername} (${offUserId})`)
          broadcastToFriends({ id: offUserId, username: offUsername }, 'user_offline', {
            userId: offUserId,
            username: offUsername,
          })
        })
      }
    })
  })

  return io
}

export function getIO() {
  return io
}
