import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMomentsStore } from '@/store/momentsStore'
import { api } from '@/lib/api'
import { getSocket } from '@/lib/socket'
import { ArrowLeft, ImageIcon, X, VideoIcon } from 'lucide-react'

export default function CreatePost() {
  const navigate = useNavigate()
  const addPost = useMomentsStore((s) => s.addPost)
  const [content, setContent] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoPreview, setVideoPreview] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件')
      return
    }
    // 若已选视频，先清除视频
    if (videoFile) {
      setVideoFile(null)
      setVideoPreview('')
    }
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      alert('请选择视频文件')
      return
    }
    if (file.size > 100 * 1024 * 1024) {
      alert('视频大小不能超过 100MB')
      return
    }
    // 若已选图片，先清除图片
    if (imageFile) {
      setImageFile(null)
      setImagePreview('')
    }
    setVideoFile(file)
    setVideoPreview(URL.createObjectURL(file))
  }

  const removeImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(null)
    setImagePreview('')
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  const removeVideo = () => {
    if (videoPreview) URL.revokeObjectURL(videoPreview)
    setVideoFile(null)
    setVideoPreview('')
    if (videoInputRef.current) videoInputRef.current.value = ''
  }

  // 组件卸载时清理 Object URL
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
      if (videoPreview) URL.revokeObjectURL(videoPreview)
    }
  }, [])

  const handleSubmit = async () => {
    if (!content.trim() && !imageFile && !videoFile) {
      alert('请输入内容或选择图片/视频')
      return
    }
    setSubmitting(true)
    try {
      let finalImageUrl = ''
      let finalVideoUrl = ''
      if (imageFile) {
        const uploadRes = await api.uploadFile(imageFile)
        finalImageUrl = uploadRes.url
      }
      if (videoFile) {
        const uploadRes = await api.uploadFile(videoFile)
        finalVideoUrl = uploadRes.url
      }
      const text = content.trim()
      // 若有视频，把内容与视频URL一起发送（后端保存时imageUrl存视频URL或图片URL）
      // 简化处理：imageUrl 同时支持 图片/视频 URL
      const mediaUrl = finalImageUrl || finalVideoUrl
      const res = await api.createPost(text, mediaUrl)
      addPost(res.post)
      const socket = getSocket()
      if (socket) {
        socket.emit('new_post', res.post)
      }
      navigate('/moments')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-screen bg-[#0F172A] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-[#1E293B] border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/moments')}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-white font-semibold text-lg">发布动态</h1>
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || (!content.trim() && !imageFile && !videoFile)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm rounded-lg transition-colors"
        >
          {submitting ? '发布中...' : '发布'}
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 p-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full h-40 bg-transparent text-white text-base placeholder-gray-500 resize-none focus:outline-none"
          placeholder="说点什么..."
        />

        {/* Image preview */}
        {imagePreview && (
          <div className="relative inline-block mt-3">
            <img
              src={imagePreview}
              alt=""
              className="max-h-80 rounded-xl object-contain bg-black/30"
            />
            <button
              onClick={removeImage}
              className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Video preview */}
        {videoPreview && (
          <div className="relative inline-block mt-3">
            <video
              src={videoPreview}
              controls
              className="max-h-80 rounded-xl bg-black/60"
            />
            <button
              onClick={removeVideo}
              className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Media buttons */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => imageInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-[#1E293B] hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
          >
            <ImageIcon className="w-5 h-5" />
            <span className="text-sm">添加图片</span>
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />

          <button
            onClick={() => videoInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-[#1E293B] hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
          >
            <VideoIcon className="w-5 h-5" />
            <span className="text-sm">添加视频</span>
          </button>
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            onChange={handleVideoSelect}
            className="hidden"
          />
        </div>

        <p className="text-xs text-gray-500 mt-3">
          图片/视频只能二选一，视频不超过 100MB
        </p>
      </div>
    </div>
  )
}
