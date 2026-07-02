/**
 * 文件下载路由 —— 简化实现
 */
import { Router, type Request, type Response } from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads')

const router = Router()

router.get('/:filename', (req: Request, res: Response): void => {
  try {
    const filename = String(req.params.filename || '')
    // 防止目录穿越：只允许 [a-z0-9-_.]
    if (!/^[a-z0-9._-]+$/i.test(filename)) {
      res.status(400).json({ success: false, error: '无效的文件名' })
      return
    }
    const fullPath = path.resolve(UPLOAD_DIR, filename)
    // 二次防护：确保解析后的路径在 uploads 目录内
    if (!fullPath.startsWith(path.resolve(UPLOAD_DIR))) {
      res.status(400).json({ success: false, error: '无效的文件名' })
      return
    }
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ success: false, error: '文件不存在' })
      return
    }
    res.sendFile(fullPath)
  } catch (error: any) {
    console.error('[download]', error?.message || error)
    res.status(500).json({ success: false, error: '下载失败' })
  }
})

export default router
