import { create } from 'zustand'
import { api, type Message } from '@/lib/api'

interface ChatState {
  messages: Record<number, Message[]>
  onlineUsers: number[]
  typingUsers: Record<number, boolean>
  loadMessages: (friendId: number) => Promise<void>
  addMessage: (message: Message) => void
  setOnlineUsers: (users: number[]) => void
  setTypingUser: (userId: number, isTyping: boolean) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  onlineUsers: [],
  typingUsers: {},

  loadMessages: async (friendId) => {
    const res = await api.getMessages(friendId)
    set((state) => ({
      messages: { ...state.messages, [friendId]: res.messages },
    }))
  },

  addMessage: (message) => {
    set((state) => {
      const friendId = message.senderId === (JSON.parse(localStorage.getItem('user') || '{}').id)
        ? message.receiverId
        : message.senderId

      const existing = state.messages[friendId] || []
      // 避免重复消息
      if (existing.some((m) => m.id === message.id)) {
        return state
      }

      return {
        messages: {
          ...state.messages,
          [friendId]: [...existing, message],
        },
      }
    })
  },

  setOnlineUsers: (users) => {
    set({ onlineUsers: users })
  },

  setTypingUser: (userId, isTyping) => {
    set((state) => ({
      typingUsers: { ...state.typingUsers, [userId]: isTyping },
    }))
  },
}))