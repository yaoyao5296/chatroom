/**
 * 文件上传路由 —— 单核极限优化版
 * 支持 multer FormData 上传
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import multerLib from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads')

if (!fs.existsSync(UPLOAD_DIR)) {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }) } catch {}
}

const router = Router()

// ESM 兼容：multer 是 CJS 模块，需要取 .default
const multer = (multerLib as any).default || multerLib

// multer 配置：磁盘存储直接写文件，内存存储也可以
const storage = multer.diskStorage({
  destination: function (_req: any, _file: any, cb: any) {
    cb(null, UPLOAD_DIR)
  },
  filename: function (_req: any, file: any, cb: any) {
    // 生成唯一文件名：随机16字符 + 时间戳 + 扩展名
    const random = crypto.randomBytes(8).toString('hex')
    const ext = path.extname(file.originalname) || (file.mimetype ? '.' + file.mimetype.split('/')[1] : '.png')
    cb(null, `${random}-${Date.now()}${ext}`)
  }
})

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowedTypes = [
      'image/', 'video/', 'audio/',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument',
      'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
      'application/zip', 'application/x-rar-compressed',
      'application/x-7z-compressed', 'text/',
      'application/json', 'application/xml',
    ]
    const ok = allowedTypes.some((t) => file.mimetype.startsWith(t))
    if (ok) {
      cb(null, true)
    } else {
      cb(new Error('不支持的文件类型'))
    }
  },
})

// multer 错误处理中间件
function uploadErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err) {
    console.error('[upload error]', err.message || err)
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: '文件大小不能超过100MB' })
    }
    return res.status(400).json({ success: false, error: err.message || '上传失败' })
  }
  next()
}

// FormData 上传 (multipart/form-data)
router.post('/', upload.single('file'), uploadErrorHandler, (req: Request, res: Response): void => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: '缺少文件' })
      return
    }

    // multer diskStorage 上传成功
    const filename = (req.file as any).filename
    res.json({
      success: true,
      url: `/uploads/${filename}`,
      type: req.file.mimetype,
      contentType: req.file.mimetype,
      originalName: req.file.originalname,
    })
  } catch (error: any) {
    console.error('[upload]', error?.message || error)
    res.status(500).json({ success: false, error: '上传失败' })
  }
})

export default router
