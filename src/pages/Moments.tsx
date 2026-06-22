import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useMomentsStore } from '@/store/momentsStore'
import { api, type Post, type Comment } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { ArrowLeft, MessageCircle, Send, ImageIcon, Trash2, X, VideoIcon } from 'lucide-react'
import UserProfileModal from '@/components/UserProfileModal'

type AuthorUser = {
  userId: number
  username: string
  avatar?: string
  bio?: string
  gender?: string
  region?: string
}

function PostCard({ post, onComment, onDelete, onEnlarge, onAvatarClick }: { post: Post; onComment: () => void; onDelete: (id: number) => void; onEnlarge: (url: string) => void; onAvatarClick: (author: AuthorUser) => void }) {
  const user = useAuthStore((s) => s.user)
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')
  const [loadingComments, setLoadingComments] = useState(false)

  const loadComments = useCallback(async () => {
    setLoadingComments(true)
    try {
      const res = await api.getComments(post.id)
      setComments(res.comments)
    } catch {} finally {
      setLoadingComments(false)
    }
  }, [post.id])

  useEffect(() => {
    if (showComments) loadComments()
  }, [showComments, loadComments])

  const handleComment = async () => {
    if (!commentText.trim()) return
    try {
      const res = await api.createComment(post.id, commentText.trim())
      setComments((prev) => [...prev, res.comment])
      setCommentText('')
      onComment()
      const socket = getSocket()
      if (socket) {
        socket.emit('new_comment', { comment: res.comment, postId: post.id })
      }
    } catch (err: any) {
      alert(err.message)
    }
  }

  const formatTime = (t: string) => {
    const d = new Date(t)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    if (isToday) return `${h}:${m}`
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${h}:${m}`
  }

  const isVideo = post.imageUrl ? /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(post.imageUrl) : false

  return (
    <div className="bg-[#1E293B] rounded-2xl overflow-hidden">
      {/* 内容 */}
      <div className="p-5">
        <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>
        {post.imageUrl && isVideo && (
          <video
            src={post.imageUrl}
            controls
            preload="metadata"
            className="mt-3 rounded-xl max-h-80 w-full bg-black"
          />
        )}
        {post.imageUrl && !isVideo && (
          <button
            onClick={() => onEnlarge(post.imageUrl)}
            className="block w-full text-left mt-3"
          >
            <img
              src={post.imageUrl}
              alt=""
              className="rounded-xl max-h-60 w-full object-contain bg-[#0F172A] hover:opacity-90 transition-opacity"
              loading="lazy"
            />
          </button>
        )}
      </div>

      {/* 作者信息 */}
      <div className="px-5 pb-3 flex items-start gap-2">
        <button onClick={() => onAvatarClick({ userId: post.userId, username: post.username, avatar: post.avatar, bio: post.bio, gender: post.gender, region: post.region })} className="flex-shrink-0">
          {post.avatar ? (
            <img src={post.avatar} alt="" className="w-6 h-6 rounded-full object-cover mt-0.5" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold mt-0.5">
              {post.username[0]?.toUpperCase()}
            </div>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-blue-400 font-medium">{post.username}</span>
            {post.gender === 'male' && <span className="text-[10px] text-blue-400">♂</span>}
            {post.gender === 'female' && <span className="text-[10px] text-pink-400">♀</span>}
            {post.gender === 'other' && <span className="text-[10px] text-gray-400">⚧</span>}
            {post.region && (
              <span className="text-gray-600 flex items-center gap-0.5">
                <span>📍</span>
                <span className="truncate max-w-[80px]">{post.region}</span>
              </span>
            )}
            <span className="text-gray-600 ml-auto">{formatTime(post.createdAt)}</span>
          </div>
          {post.bio && (
            <p className="text-[11px] text-gray-500 italic mt-0.5 truncate">"{post.bio}"</p>
          )}
        </div>
        {user?.id === post.userId && (
          <button
            onClick={() => onDelete(post.id)}
            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            title="删除动态"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 评论按钮 */}
      <div className="px-5 pb-4 border-t border-gray-800 pt-3">
        <button
          onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-1.5 text-gray-400 hover:text-blue-400 transition-colors text-sm"
        >
          <MessageCircle className="w-4 h-4" />
          评论 ({post.commentCount})
        </button>
      </div>

      {/* 评论区域 */}
      {showComments && (
        <div className="border-t border-gray-800">
          {loadingComments ? (
            <div className="p-4 text-center text-gray-500 text-sm">加载中...</div>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-3 p-4">
              {comments.length === 0 ? (
                <p className="text-gray-500 text-sm text-center">暂无评论</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <button onClick={() => onAvatarClick({ userId: c.userId, username: c.username, avatar: c.avatar, bio: c.bio, gender: c.gender, region: c.region })} className="flex-shrink-0">
                      {c.avatar ? (
                        <img src={c.avatar} alt="" className="w-7 h-7 rounded-full object-cover mt-0.5" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-semibold mt-0.5">
                          {c.username[0]?.toUpperCase()}
                        </div>
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-xs text-blue-400 font-medium">{c.username}</span>
                        {c.gender === 'male' && <span className="text-[10px] text-blue-400">♂</span>}
                        {c.gender === 'female' && <span className="text-[10px] text-pink-400">♀</span>}
                        {c.gender === 'other' && <span className="text-[10px] text-gray-400">⚧</span>}
                        {c.region && (
                          <span className="text-gray-600 text-[11px] flex items-center gap-0.5">
                            <span>📍</span>
                            <span className="truncate max-w-[80px]">{c.region}</span>
                          </span>
                        )}
                        <span className="text-xs text-gray-600">{formatTime(c.createdAt)}</span>
                      </div>
                      {c.bio && <p className="text-[11px] text-gray-500 italic mt-0.5 truncate">"{c.bio}"</p>}
                      <p className="text-sm text-gray-300 mt-0.5">{c.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 输入评论 */}
          <div className="flex items-center gap-2 border-t border-gray-800 p-3">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleComment() }}
              className="flex-1 px-3 py-1.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="写评论..."
            />
            <button
              onClick={handleComment}
              disabled={!commentText.trim()}
              className="p-1.5 text-blue-400 hover:text-blue-300 disabled:text-gray-600 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Moments() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const posts = useMomentsStore((s) => s.posts)
  const setPosts = useMomentsStore((s) => s.setPosts)
  const addPost = useMomentsStore((s) => s.addPost)
  const removePost = useMomentsStore((s) => s.removePost)
  const addComment = useMomentsStore((s) => s.addComment)
  const [loading, setLoading] = useState(true)
  const [enlargedImage, setEnlargedImage] = useState('')
  const [selectedProfileUser, setSelectedProfileUser] = useState<AuthorUser | null>(null)
  const [friends, setFriends] = useState<Array<{ id: number }>>([])

  const loadPosts = useCallback(async () => {
    try {
      const res = await api.getPosts()
      setPosts(res.posts)
    } catch {} finally {
      setLoading(false)
    }
  }, [setPosts])

  useEffect(() => {
    loadPosts()
    api.getFriends().then((res) => setFriends(res.friends)).catch(() => {})
  }, [loadPosts])

  // Socket 实时监听
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handleNewPost = (post: Post) => {
      addPost(post)
    }
    const handleNewComment = (data: { comment: Comment; postId: number }) => {
      addComment(data.postId, data.comment)
    }
    const handlePostDeleted = (postId: number) => {
      removePost(postId)
    }

    socket.on('new_post', handleNewPost)
    socket.on('new_comment', handleNewComment)
    socket.on('post_deleted', handlePostDeleted)

    return () => {
      socket.off('new_post', handleNewPost)
      socket.off('new_comment', handleNewComment)
      socket.off('post_deleted', handlePostDeleted)
    }
  }, [addPost, addComment, removePost])

  const handleDelete = async (postId: number) => {
    if (!confirm('确定删除这条动态吗？')) return
    try {
      await api.deletePost(postId)
      removePost(postId)
      const socket = getSocket()
      if (socket) {
        socket.emit('post_deleted', postId)
      }
    } catch (err: any) {
      alert(err.message)
    }
  }

  const handleAvatarClick = (author: AuthorUser) => {
    setSelectedProfileUser(author)
  }

  const handleAddFriend = async (userId: number, username: string) => {
    const res = await api.sendFriendRequest(username)
    // 添加成功后刷新好友列表，isFriend 判断会自动更新
    try {
      const fr = await api.getFriends()
      setFriends(fr.friends)
    } catch {}
    return res
  }

  return (
    <div className="min-h-screen bg-[#0F172A] flex flex-col">
      {/* Header */}
      <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/friends')}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-white font-semibold text-lg">动态广场</h1>
        </div>
        <button
          onClick={() => navigate('/moments/create')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          发布动态
        </button>
      </header>

      {/* Posts */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-[#1E293B] rounded-2xl p-5 animate-pulse">
                <div className="h-4 bg-gray-700 rounded w-3/4 mb-3" />
                <div className="h-4 bg-gray-700 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageCircle className="w-16 h-16 text-gray-600 mb-4" />
            <p className="text-gray-400 text-lg mb-2">还没有动态</p>
            <p className="text-gray-500 text-sm mb-6">点击右上角发布第一条动态</p>
            <button
              onClick={() => navigate('/moments/create')}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              发布动态
            </button>
          </div>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onComment={() => {}}
              onDelete={handleDelete}
              onEnlarge={(url) => setEnlargedImage(url)}
              onAvatarClick={handleAvatarClick}
            />
          ))
        )}
      </div>

      {/* 放大图片遮罩层 */}
      {enlargedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setEnlargedImage('')}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setEnlargedImage('') }}
            className="absolute top-4 right-4 p-2 text-white hover:text-gray-300 bg-black/50 rounded-full transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={enlargedImage}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* 用户资料卡弹窗 */}
      {selectedProfileUser && (
        <UserProfileModal
          user={{
            id: selectedProfileUser.userId,
            username: selectedProfileUser.username,
            avatar: selectedProfileUser.avatar,
            bio: selectedProfileUser.bio,
            gender: selectedProfileUser.gender,
            region: selectedProfileUser.region,
          }}
          currentUserId={user?.id || 0}
          isFriend={friends.some((f) => f.id === selectedProfileUser.userId)}
          onClose={() => setSelectedProfileUser(null)}
          onAddFriend={handleAddFriend}
        />
      )}
    </div>
  )
}
