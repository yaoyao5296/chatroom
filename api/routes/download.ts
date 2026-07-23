/**
 * 文件下载路由 —— 支持认证和消息 ID 查找
 */
import { Router, type Request, type Response } from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../middleware/auth.js'
import { stmtCache } from '../db.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads')

const router = Router()

// 从 Authorization header 或 query token 中提取用户 ID
function extractUserId(req: Request): number | null {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req.query.token as string)
    if (!token) return null
    const decoded = jwt.verify(token, JWT_SECRET) as any
    return decoded.id || null
  } catch {
    return null
  }
}

// 从文件路径中提取原始文件名
function getOriginalName(filePath: string): string {
  const base = path.basename(filePath)
  // 文件名格式: {random}-{timestamp}.ext → 提取时间戳后的部分作为显示名
  return base
}

router.get('/:id', (req: Request, res: Response): void => {
  try {
    const userId = extractUserId(req)
    if (!userId) {
      res.status(401).json({ success: false, error: '请先登录' })
      return
    }

    const id = String(req.params.id || '')
    let filePath: string | null = null

    // 判断是数字 ID（消息查找）还是文件名
    if (/^\d+$/.test(id)) {
      // 数字 ID：查找消息中的文件
      const messageId = parseInt(id, 10)
      const msg = stmtCache
        .get('SELECT fileUrl, type FROM messages WHERE id = ? AND (senderId = ? OR receiverId = ?)')
        .get(messageId, userId, userId) as any
      if (msg?.fileUrl) {
        const filename = path.basename(msg.fileUrl)
        filePath = path.resolve(UPLOAD_DIR, filename)
      }
      if (!filePath) {
        // 也查群聊消息
        const gmsg = stmtCache
          .get('SELECT gm.fileUrl, gm.type FROM group_messages gm JOIN group_members mem ON gm.groupId = mem.groupId WHERE gm.id = ? AND mem.userId = ?')
          .get(messageId, userId) as any
        if (gmsg?.fileUrl) {
          filePath = path.resolve(UPLOAD_DIR, path.basename(gmsg.fileUrl))
        }
      }
    } else {
      // 文件名：直接下载
      if (!/^[a-z0-9._-]+$/i.test(id)) {
        res.status(400).json({ success: false, error: '无效的文件名' })
        return
      }
      filePath = path.resolve(UPLOAD_DIR, id)
    }

    if (!filePath) {
      res.status(404).json({ success: false, error: '文件不存在' })
      return
    }

    // 路径穿越防护
    if (!filePath.startsWith(path.resolve(UPLOAD_DIR))) {
      res.status(400).json({ success: false, error: '无效的文件名' })
      return
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: '文件不存在' })
      return
    }

    const originalName = getOriginalName(filePath)
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`)
    res.sendFile(filePath)
  } catch (error: any) {
    console.error('[download]', error?.message || error)
    res.status(500).json({ success: false, error: '下载失败' })
  }
})

export default router