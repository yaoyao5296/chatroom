/**
 * 文件上传路由（VIP 用户可上传更大文件）
 */
import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'path'
import jwt from 'jsonwebtoken'
import { fileURLToPath } from 'url'
import fs from 'fs'
import db from '../db.js'
import { JWT_SECRET } from './auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = Router()

// 确保上传目录存在
const uploadsDir = path.join(__dirname, '..', '..', 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// 配置文件存储
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    const ext = path.extname(file.originalname)
    cb(null, uniqueSuffix + ext)
  },
})

function authMiddleware(req: Request, res: Response, next: any) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未登录' })
    return
  }
  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    ;(req as any).user = decoded
    next()
  } catch {
    res.status(401).json({ success: false, error: '登录已过期' })
  }
}

/**
 * 上传文件
 * POST /api/upload
 */
router.post('/', authMiddleware, (req: Request, res: Response): void => {
  // 检查用户 VIP 状态
  const userId = (req as any).user.id
  const user = db.prepare('SELECT vip, vipExpiresAt FROM users WHERE id = ?').get(userId) as any
  const isVip = user?.vip === 1 && user?.vipExpiresAt && user.vipExpiresAt > new Date().toISOString()
  const maxSize = isVip ? 500 * 1024 * 1024 : 10 * 1024 * 1024 // VIP: 500MB, 普通: 10MB

  const upload = multer({
    storage,
    limits: { fileSize: maxSize },
  })

  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const limit = isVip ? '500MB' : '10MB'
          res.status(400).json({ success: false, error: `文件大小不能超过${limit}` })
          return
        }
        res.status(400).json({ success: false, error: err.message })
        return
      }
      res.status(400).json({ success: false, error: err.message })
      return
    }

    if (!req.file) {
      res.status(400).json({ success: false, error: '请选择文件' })
      return
    }

    const fileUrl = `/uploads/${req.file.filename}`
    let fileType = 'file'
    if (req.file.mimetype.startsWith('image/')) fileType = 'image'
    else if (req.file.mimetype.startsWith('video/')) fileType = 'video'

    res.json({
      success: true,
      url: fileUrl,
      type: fileType,
      originalName: req.file.originalname,
    })
  })
})

export default router