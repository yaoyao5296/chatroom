import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/lib/api'
import { ArrowLeft, Trash2, Shield, Search, AlertTriangle, X } from 'lucide-react'

interface UserInfo {
  id: number
  username: string
  email: string
  avatar: string
  bio: string
  gender: string
  region: string
  active: number
  isOfficial: number
  vip: number
  vipExpiresAt: string | null
}

export default function Admin() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const [users, setUsers] = useState<UserInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<UserInfo | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [success, setSuccess] = useState('')

  if (!user?.isOfficial) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-2xl p-8 max-w-md w-full text-center border border-slate-700">
          <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">权限不足</h2>
          <p className="text-slate-400 mb-6">只有官方管理员才能访问管理后台</p>
          <button onClick={() => navigate('/friends')} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors">返回首页</button>
        </div>
      </div>
    )
  }

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true); setError('')
    try {
      const res = await api.request('/user/admin/list')
      if (res.success) setUsers(res.users)
      else setError(res.error || '加载失败')
    } catch (e: any) { setError(e?.message || '网络错误') }
    setLoading(false)
  }

  async function handleDelete(target: UserInfo) {
    setDeleting(true); setError(''); setSuccess('')
    try {
      const res = await api.request(`/user/admin/${target.id}`, { method: 'DELETE' })
      if (res.success) {
        setSuccess(`用户 ${target.username} 已删除`)
        setUsers(users.filter(u => u.id !== target.id))
        setConfirmDelete(null)
      } else { setError(res.error || '删除失败') }
    } catch (e: any) { setError(e?.message || '网络错误') }
    setDeleting(false)
  }

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-slate-900">
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-lg border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/friends')} className="p-2 hover:bg-slate-800 rounded-xl transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-400" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">管理后台</h1>
            <p className="text-xs text-slate-500">共 {users.length} 个用户</p>
          </div>
          <button onClick={loadUsers} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-xl transition-colors">刷新</button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input type="text" placeholder="搜索用户名或邮箱..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500" />
        </div>
      </div>

      {error && (
        <div className="max-w-4xl mx-auto px-4 mb-3">
          <div className="flex items-center gap-2 bg-red-900/30 border border-red-800 text-red-300 px-4 py-2.5 rounded-xl text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /><span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto p-1 hover:bg-red-800/50 rounded-lg"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}
      {success && (
        <div className="max-w-4xl mx-auto px-4 mb-3">
          <div className="flex items-center gap-2 bg-green-900/30 border border-green-800 text-green-300 px-4 py-2.5 rounded-xl text-sm">
            <span>{success}</span>
            <button onClick={() => setSuccess('')} className="ml-auto p-1 hover:bg-green-800/50 rounded-lg"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 pb-20">
        {loading ? <div className="text-center py-20 text-slate-500">加载中...</div>
        : filteredUsers.length === 0 ? <div className="text-center py-20 text-slate-500">没有找到用户</div>
        : <div className="space-y-2">
            {filteredUsers.map(u => (
              <div key={u.id} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {u.avatar ? <img src={u.avatar} alt="" className="w-full h-full rounded-full object-cover" /> : u.username[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm truncate">{u.username}</span>
                    {u.isOfficial === 1 && <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-md font-medium">官方</span>}
                    {u.vip > 0 && <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-md font-medium">VIP</span>}
                    {!u.active && <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-md font-medium">已注销</span>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">ID: {u.id} {u.email ? `· ${u.email}` : ''}</div>
                </div>
                {u.id !== user.id && u.isOfficial !== 1 && (
                  <button onClick={() => setConfirmDelete(u)} className="p-2 hover:bg-red-500/20 text-red-400 rounded-xl transition-colors" title="删除用户">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        }
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl p-6 max-w-sm w-full border border-slate-700">
            <div className="text-center mb-4">
              <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-white mb-1">确认删除用户</h3>
              <p className="text-sm text-slate-400">此操作将永久删除 <span className="text-white font-medium">{confirmDelete.username}</span> 及其所有数据，不可恢复！</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl transition-colors text-sm" disabled={deleting}>取消</button>
              <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors text-sm" disabled={deleting}>{deleting ? '删除中...' : '确认删除'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
