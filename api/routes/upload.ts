/**
 * 文件上传路由 —— 单核极限优化版
 * 简化实现：写入 uploads/ 目录，返回文件 URL
 */
import { Router, type Request, type Response } from 'express'
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

router.post('/', (req: Request, res: Response): void => {
  try {
    // 读取 JSON body 中的 base64 dataURL：{ file: "data:image/png;base64,...." }
    const body = req.body as { file?: string; filename?: string }
    if (!body.file) {
      res.status(400).json({ success: false, error: '缺少文件' })
      return
    }

    const dataUrl = body.file
    const comma = dataUrl.indexOf(',')
    if (comma < 0) {
      res.status(400).json({ success: false, error: '文件格式错误' })
      return
    }
    const meta = dataUrl.slice(0, comma)
    const m = /^data:(image\/[a-z0-9.+-]+);base64$/i.exec(meta)
    if (!m) {
      res.status(400).json({ success: false, error: '仅支持图片' })
      return
    }
    const contentType = m[1]
    const ext = contentType.split('/')[1] || 'png'
    const base64 = dataUrl.slice(comma + 1)
    const buf = Buffer.from(base64, 'base64')

    // 生成唯一文件名
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)
    const fname = `${hash}-${Date.now()}.${ext}`
    const fullPath = path.join(UPLOAD_DIR, fname)
    fs.writeFileSync(fullPath, buf)

    res.json({ success: true, url: `/uploads/${fname}`, contentType })
  } catch (error: any) {
    console.error('[upload]', error?.message || error)
    res.status(500).json({ success: false, error: '上传失败' })
  }
})

export default router
