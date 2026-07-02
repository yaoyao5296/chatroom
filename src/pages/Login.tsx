import { useState, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/lib/api'
import { captureFaceDescriptor, supportsFaceDetector, getModelStatus, onModelStatusChange, type ModelStatus } from '@/lib/face'
import { Camera, Eye, EyeOff, Shield, Loader2, ScanFace, KeyRound } from 'lucide-react'

/**
 * 人脸登录：
 *  1) 使用 <video> + getUserMedia 打开摄像头
 *  2) 优先使用 FaceDetector API 精确定位人脸
 *  3) 不可用时降级为传统中心裁剪
 *  4) 提取 64 维归一化特征向量
 *  5) 后端余弦相似度匹配（阈值 0.85）
 */

export default function Login() {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [faceMode, setFaceMode] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [faceLoading, setFaceLoading] = useState(false)
  const [modelStatus, setModelStatus] = useState<ModelStatus>(getModelStatus())

  useEffect(() => {
    setModelStatus(getModelStatus())
    return onModelStatusChange(setModelStatus)
  }, [])
  const [faceError, setFaceError] = useState('')
  const [success, setSuccess] = useState('')

  // 忘记密码
  const [forgotModal, setForgotModal] = useState(false)
  const [forgotUsername, setForgotUsername] = useState('')
  const [forgotNewPassword, setForgotNewPassword] = useState('')
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const [forgotSuccess, setForgotSuccess] = useState('')
  const [forgotShowPassword, setForgotShowPassword] = useState(false)

  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopCamera()
    }
  }, [])

  async function startCamera() {
    setFaceError('')
    setSuccess('')
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setFaceError('当前浏览器不支持摄像头访问，请使用 Chrome/Safari 等现代浏览器')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
        setCameraReady(true)
      }
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('Permission denied') || msg.includes('PermissionDisallowed')) {
        setFaceError('摄像头权限被拒绝，请在浏览器设置中允许访问摄像头后重试')
      } else if (msg.includes('NotFoundError') || msg.includes('DevicesNotFoundError')) {
        setFaceError('未检测到可用摄像头，请确认设备已连接摄像头')
      } else if (msg.includes('NotAllowed') || msg.includes('NotReadable')) {
        setFaceError('摄像头被其他应用占用，请关闭其他使用摄像头的程序后重试')
      } else {
        setFaceError(msg || '无法打开摄像头，请检查权限设置')
      }
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCameraReady(false)
  }

  async function handleCaptureAndLogin() {
    if (!videoRef.current || !canvasRef.current) {
      setFaceError('摄像头未准备好，请稍后')
      return
    }
    setFaceLoading(true)
    setFaceError('')
    setSuccess('')
    try {
      const { descriptor, precise } = await captureFaceDescriptor(videoRef.current, canvasRef.current)
      if (!mountedRef.current) return
      if (!descriptor || descriptor.length < 4) {
        setFaceError('未能采集人脸特征，请调整光线后重试')
        return
      }

      const res = await api.loginWithFace(descriptor, loginId.trim() || undefined)
      if (!mountedRef.current) return
      if (res.success) {
        localStorage.setItem('token', res.token)
        localStorage.setItem('user', JSON.stringify(res.user))
        useAuthStore.setState({ user: res.user, token: res.token, isLoggedIn: true })
        const mode = precise ? '精准模式' : '兼容模式'
        setSuccess(`识别成功 (${mode} score=${res.score})，正在进入聊天...`)
        stopCamera()
        setTimeout(() => {
          if (mountedRef.current) navigate('/friends')
        }, 600)
      }
    } catch (err: any) {
      setFaceError(err.message || '识别失败，请重试或用密码登录')
    } finally {
      setFaceLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(loginId, password)
      navigate('/friends')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function toggleFaceMode(on: boolean) {
    setFaceMode(on)
    if (on) {
      setError('')
      startCamera()
    } else {
      stopCamera()
    }
  }

  // 打开忘记密码模态框：清空状态
  function openForgotModal() {
    setForgotModal(true)
    setForgotError('')
    setForgotSuccess('')
    setForgotUsername(loginId.trim() || '')
    setForgotNewPassword('')
    setForgotConfirmPassword('')
  }

  // 关闭忘记密码模态框
  function closeForgotModal() {
    setForgotModal(false)
  }

  // 提交重置密码
  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault()
    setForgotError('')
    setForgotSuccess('')
    if (!forgotUsername.trim()) { setForgotError('请输入用户名'); return }
    if (!forgotNewPassword) { setForgotError('请输入新密码'); return }
    if (forgotNewPassword.length < 6) { setForgotError('新密码长度不能少于 6 个字符'); return }
    if (forgotNewPassword !== forgotConfirmPassword) { setForgotError('两次输入的新密码不一致'); return }

    setForgotLoading(true)
    try {
      await api.forgotPassword(forgotUsername.trim(), forgotNewPassword)
      setForgotSuccess('密码重置成功！2 秒后返回登录...')
      setTimeout(() => {
        setForgotModal(false)
        setPassword('')
      }, 1800)
    } catch (err: any) {
      setForgotError(err.message || '重置失败，请重试')
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="h-screen bg-[#0F172A] flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md py-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 mb-4">
            <Shield className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold text-white">ChatRoom</h1>
          <p className="text-gray-400 mt-2">随时随地，畅快聊天</p>
        </div>

        <div className="bg-[#1E293B] rounded-2xl p-6 shadow-xl space-y-4">
          <h2 className="text-xl font-semibold text-white text-center">{faceMode ? '人脸识别登录' : '账号登录'}</h2>

          {!faceMode ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3">{error}</div>
              )}

              <div>
                <label className="block text-sm text-gray-300 mb-1">账号</label>
                <input
                  type="text"
                  autoComplete="username"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="用户名 / 邮箱"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">支持用户名或邮箱登录</p>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">密码</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 pr-11 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="输入密码"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1 rounded"
                    aria-label="切换密码可见"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm -mt-1">
                <button
                  type="button"
                  onClick={openForgotModal}
                  className="text-gray-400 hover:text-blue-400 transition-colors flex items-center gap-1"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  忘记密码？
                </button>
                <Link to="/register" className="text-blue-400 hover:text-blue-300 transition-colors">
                  还没有账号？立即注册
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? '登录中...' : '登录'}
              </button>

              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 border-t border-gray-700" />
                <span className="text-xs text-gray-500">或</span>
                <div className="flex-1 border-t border-gray-700" />
              </div>

              <button
                type="button"
                onClick={() => toggleFaceMode(true)}
                className="w-full py-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <ScanFace className="w-4 h-4" />
                用人脸识别登录
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {faceError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-3">{faceError}</div>
              )}
              {success && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm rounded-lg p-3">{success}</div>
              )}

              {/* 模型加载状态 */}
              {modelStatus === 'loading' && (
                <div className="bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm rounded-lg p-3 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>正在加载人脸识别模型（约 6.2MB），请稍候...</span>
                </div>
              )}
              {modelStatus === 'error' && (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm rounded-lg p-3">
                  人脸识别模型加载失败，将使用兼容模式（精度较低）
                </div>
              )}

              <div className="relative aspect-square w-full bg-black rounded-xl overflow-hidden border border-gray-700 flex items-center justify-center">
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                {/* 人脸框引导 */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-48 border-2 border-dashed border-emerald-400 rounded-full opacity-80" />
                </div>
                {!cameraReady && !faceError && (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
                    <div className="flex flex-col items-center gap-2">
                      <Camera className="w-10 h-10 animate-pulse" />
                      <span>正在请求摄像头权限...</span>
                    </div>
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-500 text-center">
                请将脸部对准绿色虚线圆圈，保持光线充足。人脸特征仅在本地生成，上传到服务器后不会保存原始图像。
              </p>

              <div>
                <label className="block text-sm text-gray-300 mb-1">
                  用户名（可选，提供后识别更快更准）
                </label>
                <input
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="留空则在所有用户中自动匹配"
                />
              </div>

              <button
                onClick={handleCaptureAndLogin}
                disabled={!cameraReady || faceLoading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/40 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                {faceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanFace className="w-4 h-4" />}
                {faceLoading ? '正在识别...' : '拍照识别并登录'}
              </button>

              <button
                onClick={() => toggleFaceMode(false)}
                className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
              >
                返回账号密码登录
              </button>

              {/* 隐藏 canvas，用来采样图片特征 */}
              <canvas ref={canvasRef} className="hidden" />
            </div>
          )}
        </div>

        {/* 忘记密码模态框 */}
        {forgotModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={closeForgotModal}>
            <div className="bg-[#1E293B] rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-blue-400" />
                重置密码
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                输入您的用户名和新密码，系统将重置您的登录密码。
              </p>

              <form onSubmit={handleForgotSubmit} className="space-y-3">
                {forgotError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg p-2.5">{forgotError}</div>
                )}
                {forgotSuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm rounded-lg p-2.5">{forgotSuccess}</div>
                )}

                <div>
                  <label className="block text-sm text-gray-300 mb-1">用户名</label>
                  <input
                    type="text"
                    value={forgotUsername}
                    onChange={(e) => setForgotUsername(e.target.value)}
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="请输入注册时的用户名"
                    required
                    disabled={forgotLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1">新密码（至少 6 位）</label>
                  <div className="relative">
                    <input
                      type={forgotShowPassword ? 'text' : 'password'}
                      value={forgotNewPassword}
                      onChange={(e) => setForgotNewPassword(e.target.value)}
                      className="w-full px-4 py-2.5 pr-11 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder="请输入新密码"
                      required
                      disabled={forgotLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setForgotShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1 rounded"
                      tabIndex={-1}
                    >
                      {forgotShowPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1">确认新密码</label>
                  <input
                    type={forgotShowPassword ? 'text' : 'password'}
                    value={forgotConfirmPassword}
                    onChange={(e) => setForgotConfirmPassword(e.target.value)}
                    className="w-full px-4 py-2.5 bg-[#0F172A] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="请再次输入新密码"
                    required
                    disabled={forgotLoading}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleForgotSubmit(e) }}
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closeForgotModal}
                    disabled={forgotLoading}
                    className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-700/50 text-white rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {forgotLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {forgotLoading ? '提交中...' : '确认重置'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
