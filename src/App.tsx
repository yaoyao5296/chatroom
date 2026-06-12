import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import { useAuthStore } from "@/store/authStore"
import { getSocket } from "@/lib/socket"
import { useChatStore } from "@/store/chatStore"
import type { Message } from "@/lib/api"
import Login from "@/pages/Login"
import Register from "@/pages/Register"
import Friends from "@/pages/Friends"
import Chat from "@/pages/Chat"
import Settings from "@/pages/Settings"

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  if (!isLoggedIn) return <Navigate to="/" replace />
  return <>{children}</>
}

function SocketListener() {
  const addMessage = useChatStore((s) => s.addMessage)
  const setOnlineUsers = useChatStore((s) => s.setOnlineUsers)

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handleNewMessage = (message: Message) => {
      addMessage(message)
    }

    const handleOnlineUsers = (users: number[]) => {
      setOnlineUsers(users)
    }

    socket.on('new_message', handleNewMessage)
    socket.on('online_users', handleOnlineUsers)

    return () => {
      socket.off('new_message', handleNewMessage)
      socket.off('online_users', handleOnlineUsers)
    }
  }, [addMessage, setOnlineUsers])

  return null
}

export default function App() {
  const init = useAuthStore((s) => s.init)
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)

  useEffect(() => {
    init()
  }, [init])

  return (
    <Router>
      {isLoggedIn && <SocketListener />}
      <Routes>
        <Route path="/" element={isLoggedIn ? <Navigate to="/friends" replace /> : <Login />} />
        <Route path="/register" element={isLoggedIn ? <Navigate to="/friends" replace /> : <Register />} />
        <Route path="/friends" element={<ProtectedRoute><Friends /></ProtectedRoute>} />
        <Route path="/chat/:friendId" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}