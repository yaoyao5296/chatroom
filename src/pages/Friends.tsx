import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useChatStore } from '@/store/chatStore'
import { api } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { MessageCircle, LogOut, UserPlus, Search, Users, Camera, Trash2, X, Settings as SettingsIcon } from 'lucide-react'

interface Friend {
  id: number
  username: string
  avatar: string
  active: number
}

export default function Friends() {
  const [friends, setFriends] = useState<Friend[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ id: number; username: string }>>([])
  const [showAdd, setShowAdd] = useState(false)
  const [addUsername, setAddUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Friend | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const longPressTriggered = useRef(false)

  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const onlineUsers = useChatStore((s) => s.onlineUsers)
  const navigate = useNavigate()

  const updateUserInfo = useCallback(() => {
    const userStr = localStorage.getItem('user')
    if (userStr) {
      try {
        return JSON.parse(userStr)
      } catch {}
    }
    return user
  }, [user])

  const loadFriends = useCallback(async () => {
    try {
      const res = await api.getFriends()
      setFriends(res.friends)
    } catch (err: any) {
      console.error('加载好友列表失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    socket.on('friend_added', () => loadFriends())
    return () => { socket.off('friend_added') }
  }, [loadFriends])

  const handleSearch = async (q: string) => {
    setSearchQuery(q)
    if (!q.trim()) { setSearchResults([]); return }
    try {
      const res = await api.searchUsers(q)
      setSearchResults(res.users)
    } catch { setSearchResults([]) }
  }

  const handleAddFriend = async () => {
    if (!addUsername.trim()) return
    setError('')
    try {
      await api.addFriend(addUsername)
      setShowAdd(false)
      setAddUsername('')
      loadFriends()
    } catch (err: any) { setError(err.message) }
  }

  // 长按删除
  const handleTouchStart = (friend: Friend) => {
    longPressTriggered.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true
      setDeleteTarget(friend)
    }, 600)
  }

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const handleMouseDown = (friend: Friend) => {
    longPressTriggered.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true
      setDeleteTarget(friend)
    }, 600)
  }

  const handleMouseUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const handleDeleteFriend = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteFriend(deleteTarget.id)
      setDeleteTarget(null)
      loadFriends()
    } catch (err: any) {
      setError(err.message)
    }
  }

  // 头像上传
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('图片大小不能超过5MB')
      return
    }

    try {
      const res = await api.uploadFile(file)
      await api.updateAvatar(res.url)

      // 更新 localStorage 中的用户信息
      const userInfo = updateUserInfo()
      userInfo.avatar = res.url
      localStorage.setItem('user', JSON.stringify(userInfo))

      setShowAvatarModal(false)
      setAvatarUrl(res.url)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const currentUser = updateUserInfo()
  const userAvatar = currentUser?.avatar || ''

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-[#0F172A] flex">
      {/* Sidebar */}
      <div className="w-80 bg-[#1E293B] flex flex-col border-r border-gray-800">
        {/* Header */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <div
              className="flex items-center gap-3 cursor-pointer group relative"
              onClick={() => setShowAvatarModal(true)}
            >
              <div className="relative">
                {userAvatar ? (
                  <img
                    src={userAvatar}
                    alt="avatar"
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold">
                    {user?.username?.[0]?.toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                  <Camera className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              <div>
                <h2 className="text-white font-semibold">{user?.username}</h2>
                <p className="text-xs text-gray-400">在线</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate('/settings')}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                title="设置"
              >
                <SettingsIcon className="w-5 h-5" />
              </button>
              <button
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                title="退出登录"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#0F172A] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="搜索用户..."
            />
            {searchQuery && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#1E293B] border border-gray-700 rounded-lg shadow-xl z-10">
                {searchResults.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      setAddUsername(u.username)
                      setShowAdd(true)
                      setSearchQuery('')
                      setSearchResults([])
                    }}
                    className="w-full px-4 py-2.5 text-left text-white hover:bg-gray-700/50 first:rounded-t-lg last:rounded-b-lg transition-colors"
                  >
                    {u.username}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Friends List */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Users className="w-4 h-4" />
                <span>好友列表 ({friends.length})</span>
              </div>
              <button
                onClick={() => setShowAdd(true)}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                title="添加好友"
              >
                <UserPlus className="w-4 h-4" />
              </button>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-gray-700" />
                    <div className="flex-1"><div className="h-4 bg-gray-700 rounded w-24" /></div>
                  </div>
                ))}
              </div>
            ) : friends.length === 0 ? (
              <div className="text-center py-8">
                <MessageCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">还没有好友</p>
                <p className="text-gray-600 text-xs mt-1">点击右上角 + 添加好友</p>
              </div>
            ) : (
              <div className="space-y-1">
                {friends.map((friend) => (
                  <div
                    key={friend.id}
                    onTouchStart={() => handleTouchStart(friend)}
                    onTouchEnd={handleTouchEnd}
                    onMouseDown={() => handleMouseDown(friend)}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onClick={() => {
                      if (!longPressTriggered.current && friend.active === 1) {
                        navigate(`/chat/${friend.id}`)
                      }
                    }}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-colors group cursor-pointer select-none ${
                      friend.active === 1
                        ? 'hover:bg-gray-700/50'
                        : 'opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <div className="relative">
                      {friend.avatar ? (
                        <img src={friend.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white font-semibold text-sm">
                          {friend.username[0]?.toUpperCase()}
                        </div>
                      )}
                      {friend.active === 1 && onlineUsers.includes(friend.id) && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-[#1E293B]" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      {friend.active === 1 ? (
                        <>
                          <p className="text-white text-sm font-medium">{friend.username}</p>
                          <p className="text-xs text-gray-500">
                            {onlineUsers.includes(friend.id) ? '在线' : '离线'}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-gray-400 text-sm font-medium">{friend.username}</p>
                          <p className="text-xs text-red-400/80">已注销 · 不可聊天</p>
                        </>
                      )}
                    </div>
                    {friend.active === 1 && (
                      <Trash2 className="w-4 h-4 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Welcome area */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-500/10 mb-4">
            <MessageCircle className="w-10 h-10 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">欢迎来到 ChatRoom</h2>
          <p className="text-gray-400">选择一个好友开始聊天</p>
        </div>
      </div>

      {/* Add friend modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-semibold text-white mb-4">添加好友</h3>
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3 mb-4">{error}</div>
            )}
            <input
              type="text"
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors mb-4"
              placeholder="输入好友用户名"
            />
            <div className="flex gap-3">
              <button onClick={() => { setShowAdd(false); setError(''); setAddUsername('') }}
                className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">取消</button>
              <button onClick={handleAddFriend}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">添加</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">删除好友</h3>
                <p className="text-sm text-gray-400">确定要删除 {deleteTarget.username} 吗？</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">取消</button>
              <button onClick={handleDeleteFriend}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">删除</button>
            </div>
          </div>
        </div>
      )}

      {/* Avatar upload modal */}
      {showAvatarModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">更换头像</h3>
              <button onClick={() => setShowAvatarModal(false)}
                className="p-1 text-gray-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3 mb-4">{error}</div>
            )}

            {/* Current avatar */}
            <div className="flex justify-center mb-6">
              {userAvatar ? (
                <img src={userAvatar} alt="" className="w-24 h-24 rounded-full object-cover border-4 border-gray-700" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-blue-600 flex items-center justify-center text-white text-3xl font-semibold border-4 border-gray-700">
                  {user?.username?.[0]?.toUpperCase()}
                </div>
              )}
            </div>

            <label className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors">
              <Camera className="w-5 h-5" />
              选择图片
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
            </label>

            <p className="text-xs text-gray-500 text-center mt-3">支持 JPG、PNG，最大 5MB</p>
          </div>
        </div>
      )}
    </div>
  )
}