/**
 * 用户资料卡弹窗 — 点击动态/好友头像时展示
 * 显示：头像、用户名、性别、地区、个人简介
 * 底部：添加好友按钮（自己或已是好友则不显示）
 */
import { useState } from 'react'
import { X, MapPin, UserPlus, Check, Loader2, Shield } from 'lucide-react'
import { resolveStaticUrl } from '@/lib/api'

interface UserProfileModalProps {
  /** 要展示的用户资料（来自动态/好友数据） */
  user: {
    id: number
    username: string
    avatar?: string
    bio?: string
    gender?: string
    region?: string
  }
  /** 当前登录用户 ID（用于判断是否是自己） */
  currentUserId: number
  /** 是否已是好友 */
  isFriend: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 发送好友请求回调 */
  onAddFriend: (userId: number, username: string) => Promise<any>
}

const GENDER_CONFIG: Record<string, { emoji: string; label: string; color: string }> = {
  male:   { emoji: '♂', label: '男',   color: 'text-blue-400' },
  female: { emoji: '♀', label: '女',   color: 'text-pink-400' },
  other:  { emoji: '⚧', label: '其他', color: 'text-gray-400' },
}

export default function UserProfileModal({
  user,
  currentUserId,
  isFriend,
  onClose,
  onAddFriend,
}: UserProfileModalProps) {
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState('')

  const isSelf = user.id === currentUserId
  const genderCfg = user.gender ? GENDER_CONFIG[user.gender] : null
  const initial = user.username?.[0]?.toUpperCase() || '?'

  const handleAddFriend = async () => {
    if (loading || added) return
    setLoading(true)
    setError('')
    try {
      await onAddFriend(user.id, user.username)
      setAdded(true)
    } catch (err: any) {
      setError(err.message || '添加失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    /* 遮罩层 */
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* 弹窗主体 */}
      <div
        className="bg-[#1E293B] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部背景 + 头像 */}
        <div className="relative h-28 bg-gradient-to-br from-blue-600 via-cyan-600 to-indigo-700 flex items-end justify-center pb-12">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2">
            {user.avatar ? (
              <img
                src={resolveStaticUrl(user.avatar || '')}
                alt=""
                className="w-20 h-20 rounded-full object-cover border-4 border-[#1E293B] shadow-lg"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 flex items-center justify-center text-white text-2xl font-bold border-4 border-[#1E293B] shadow-lg">
                {initial}
              </div>
            )}
          </div>
        </div>

        {/* 用户名 + 性别 */}
        <div className="pt-12 pb-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <h2 className="text-white font-semibold text-lg">{user.username}</h2>
            {genderCfg && (
              <span className={`text-sm ${genderCfg.color}`} title={genderCfg.label}>
                {genderCfg.emoji}
              </span>
            )}
          </div>
          {isSelf && (
            <span className="inline-block mt-1 px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded-full">
              我
            </span>
          )}
        </div>

        {/* 基本信息区 */}
        <div className="px-6 pb-4 space-y-3">
          {/* 性别 */}
          {genderCfg && (
            <div className="flex items-center gap-2 text-sm">
              <span className={`${genderCfg.color} font-medium`}>{genderCfg.emoji}</span>
              <span className="text-gray-400">{genderCfg.label}</span>
            </div>
          )}

          {/* 地区 */}
          {user.region && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <span className="text-gray-400">{user.region}</span>
            </div>
          )}

          {/* 简介 */}
          {user.bio ? (
            <div className="bg-[#0F172A] rounded-xl p-3">
              <p className="text-sm text-gray-300 italic leading-relaxed">"{user.bio}"</p>
            </div>
          ) : (
            <div className="bg-[#0F172A] rounded-xl p-3">
              <p className="text-sm text-gray-600 italic">这个人很神秘，什么都没留下</p>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <p className="text-red-400 text-xs text-center">{error}</p>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 pb-6">
          {isSelf ? (
            /* 自己是发起者：显示用户 ID */
            <div className="flex items-center justify-center gap-1.5 py-2.5 text-xs text-gray-600">
              <Shield className="w-3.5 h-3.5" />
              <span>UID {user.id}</span>
            </div>
          ) : isFriend ? (
            /* 已是好友 */
            <div className="flex items-center justify-center gap-2 py-2.5 bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-xl">
              <Check className="w-4 h-4" />
              已添加为好友
            </div>
          ) : (
            /* 可以添加好友 */
            <button
              onClick={handleAddFriend}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm rounded-xl transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              {loading ? '发送中...' : added ? '请求已发送' : '添加为好友'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
