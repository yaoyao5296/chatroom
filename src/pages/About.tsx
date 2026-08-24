import { ArrowLeft, Info, Globe, Shield, Cpu, MessageCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function About() {
  const navigate = useNavigate()

  return (
    <div className="flex-1 flex flex-col bg-[#1E293B] h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/50">
        <button
          onClick={() => navigate(-1)}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          title="返回"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold text-white">软件说明</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-500/10 mb-4">
            <MessageCircle className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">ChatRoom</h1>
          <p className="text-gray-400 mt-1">v1.0.0</p>
        </div>

        {/* Feature cards */}
        <div className="space-y-4 mb-8">
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/30">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-blue-400" />
              </div>
              <h3 className="text-white font-semibold">实时聊天</h3>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              支持文字、图片、文件发送，群聊和私聊，消息实时推送，离线消息不丢失。
            </p>
          </div>

          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/30">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Cpu className="w-4 h-4 text-purple-400" />
              </div>
              <h3 className="text-white font-semibold">屿岸 AI 助手</h3>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              群聊中 @屿岸 即可唤醒 AI 浏览器助手，帮你搜索信息、浏览网页、填写表单等。支持 Ollama 本地部署，永久免费。
            </p>
          </div>

          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/30">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Shield className="w-4 h-4 text-green-400" />
              </div>
              <h3 className="text-white font-semibold">安全可靠</h3>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              数据本地存储，支持 JWT 认证，人脸识别登录，VIP 会员体系，端到端加密通信。
            </p>
          </div>

          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/30">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <Globe className="w-4 h-4 text-orange-400" />
              </div>
              <h3 className="text-white font-semibold">多平台支持</h3>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              支持网页版、Windows/Mac/Linux 桌面版、Android 手机 App，一次部署全平台使用。
            </p>
          </div>
        </div>

        {/* Tech stack */}
        <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/30 mb-6">
          <h3 className="text-white font-semibold mb-3">技术栈</h3>
          <div className="flex flex-wrap gap-2">
            {['React', 'TypeScript', 'Vite', 'Node.js', 'Express', 'SQLite', 'Socket.IO', 'Redis', 'Python', 'Browser Use', 'Ollama', 'Capacitor', 'Electron'].map(tech => (
              <span key={tech} className="px-2.5 py-1 bg-gray-700/50 text-gray-300 text-xs rounded-full">
                {tech}
              </span>
            ))}
          </div>
        </div>

        {/* Note */}
        <div className="bg-blue-500/10 rounded-xl p-4 border border-blue-500/20">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-300 text-sm font-medium mb-1">使用提示</p>
              <ul className="text-gray-400 text-sm space-y-1">
                <li>• 服务器需开放 3001 端口进行外网访问</li>
                <li>• 屿岸 AI 需要安装 Python 和 Ollama</li>
                <li>• Redis 用于在线状态持久化（可选）</li>
                <li>• 默认管理员账号：admin / admin123</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}