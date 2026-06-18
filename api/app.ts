/**
 * This is a API server
 */

import dotenv from 'dotenv'
dotenv.config()

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import friendsRoutes from './routes/friends.js'
import messagesRoutes from './routes/messages.js'
import uploadRoutes from './routes/upload.js'
import userRoutes from './routes/user.js'
import verificationRoutes from './routes/verification.js'
import downloadRoutes from './routes/download.js'
import postsRoutes from './routes/posts.js'
import vipRoutes from './routes/vip.js'
import aiRoutes from './routes/ai.js'
import groupRoutes from './routes/groups.js'
import unreadRoutes from './routes/unread.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ extended: true, limit: '100mb' }))

// ==================== 优化 1：Gzip 响应压缩（使用 Node 原生 zlib，零额外依赖）====================
// 典型效果：
//   - JSON API：体积减到 20-30%
//   - HTML/CSS/JS：体积减到 15-30%
//   - 已压缩文件（.jpg/.png/.mp4/.zip）：跳过
const COMPRESSIBLE = /\b(?:text\/|application\/json|application\/xml|application\/javascript|image\/svg\+xml|font\/)\b/i
const MIN_COMPRESS_BYTES = 1024 // 小于 1KB 不压缩

// 用一个简单的 Express 中间件：在 res.end 写入时检测并 gzip
app.use((req: Request, res: Response, next: NextFunction) => {
  const originalEnd = res.end.bind(res) as any
  const originalWrite = res.write.bind(res) as any
  const acceptEncoding = req.headers['accept-encoding'] || ''
  const shouldGzip = acceptEncoding.includes('gzip')

  if (!shouldGzip) return next()

  let chunks: Buffer[] = []
  let hijacked = false

  // 延迟决定：等到第一次 write/end，看 Content-Type 头是否可压缩
  function tryCompress(): boolean {
    if (hijacked) return true
    const contentType = res.getHeader('Content-Type') as string | undefined
    const contentLength = res.getHeader('Content-Length')
    // 已经设置了较大的 Content-Length，直接跳过
    if (contentLength !== undefined && Number(contentLength) < MIN_COMPRESS_BYTES) return false
    // 已经设置了 Content-Encoding，不要重复压缩
    if (res.getHeader('Content-Encoding')) return false
    if (contentType && COMPRESSIBLE.test(contentType)) {
      hijacked = true
      // 由我们来压缩：延迟到 end 再 flush
      return true
    }
    return false
  }

  res.write = function (chunk: any, encodingOrCb?: any, cb?: any): boolean {
    if (tryCompress()) {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk, typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8'))
      } else if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk)
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk))
      }
      return true
    }
    return originalWrite(chunk, encodingOrCb, cb)
  }

  ;(res as any).end = function (chunk?: any, encodingOrCb?: any, cb?: any) {
    if (typeof encodingOrCb === 'function') cb = encodingOrCb

    if (chunk !== undefined && chunk !== null) {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk, typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8'))
      } else if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk)
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk))
      }
    }

    if (hijacked && chunks.length > 0) {
      const buf = Buffer.concat(chunks)
      if (buf.length >= MIN_COMPRESS_BYTES) {
        try {
          const compressed = zlib.gzipSync(buf, { level: zlib.constants.Z_BEST_SPEED })
          // 只有真正比原体积小才返回
          if (compressed.length < buf.length - 64) {
            res.setHeader('Content-Encoding', 'gzip')
            res.setHeader('Content-Length', String(compressed.length))
            res.removeHeader('Transfer-Encoding')
            originalWrite(compressed, cb)
            return originalEnd()
          }
        } catch (e) {
          // 压缩失败，原样返回
        }
        res.setHeader('Content-Length', String(buf.length))
        originalWrite(buf, cb)
        return originalEnd()
      }
      // 体积太小，原样返回
      res.setHeader('Content-Length', String(buf.length))
      originalWrite(buf, cb)
      return originalEnd()
    }

    // 走原来的逻辑
    if (chunk !== undefined && chunk !== null) return originalEnd(chunk, encodingOrCb, cb)
    return originalEnd(cb)
  }

  next()
})

// ==================== 优化 2：上传的文件 7 天强缓存 + 前端静态资源 1 小时缓存 ====================
const uploadsPath = path.join(__dirname, '..', 'uploads')

// 上传的文件（图片/视频）不会频繁改动 → 7 天强缓存 + immutable
// 图片格式通常不可压缩 → 不启用压缩
app.use('/uploads', (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable') // 7 天
  // 图片/视频类文件：不设置 gzip（已经是压缩格式）
  const ext = path.extname(req.url).toLowerCase()
  const noGzipExts = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm', '.mov', '.avi', '.zip', '.gz']
  if (noGzipExts.includes(ext)) {
    res.setHeader('X-Accel-Buffering', 'yes') // 让反向代理直接转发
  }
  next()
}, express.static(uploadsPath))

// 生产环境：托管前端构建产物
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist')
  app.use(express.static(distPath, {
    maxAge: '1h',
    etag: true,
    index: 'index.html',
  }))
}

// ==================== 路由 ====================
app.use('/api/auth', authRoutes)
app.use('/api/friends', friendsRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/user', userRoutes)
app.use('/api/verification', verificationRoutes)
app.use('/api/download', downloadRoutes)
app.use('/api/posts', postsRoutes)
app.use('/api/vip', vipRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/groups', groupRoutes)
app.use('/api/unread', unreadRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', error)
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 生产环境 SPA fallback - 非 API 路由返回前端页面
 */
if (process.env.NODE_ENV === 'production') {
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
      res.status(404).json({ success: false, error: 'API not found' })
      return
    }
    const distPath = path.join(__dirname, '..', 'dist', 'index.html')
    res.sendFile(distPath)
  })
} else {
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'API not found',
    })
  })
}

export default app