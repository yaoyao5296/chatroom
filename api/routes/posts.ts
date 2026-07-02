/**
 * 动态（Posts）路由 —— 单核极限优化版
 */
import { Router, type Request, type Response } from 'express'
import db, { stmtCache } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()

router.get('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const tab = (req.query.tab as string) || 'all'

    let posts: any[]
    if (tab === 'official') {
      // 官方动态：只显示官方账号的帖子
      posts = stmtCache
        .get(`SELECT p.id, p.userId, p.content, p.imageUrl,
                   CASE WHEN instr(p.createdAt, 'T') THEN p.createdAt ELSE p.createdAt || 'Z' END AS createdAt,
                   u.username, u.avatar, u.bio, u.gender, u.region, u.isOfficial,
                   (SELECT COUNT(*) FROM comments WHERE postId = p.id) AS commentCount
             FROM posts p
             JOIN users u ON p.userId = u.id
             WHERE u.active = 1 AND u.isOfficial = 1
             ORDER BY p.createdAt DESC
             LIMIT 50`)
        .all() as any[]
    } else if (tab === 'friends') {
      // 好友动态：只显示好友的帖子（双向查询）
      const friendIds = stmtCache
        .get(`SELECT friendId AS id FROM friendships WHERE userId = ?
              UNION
              SELECT userId AS id FROM friendships WHERE friendId = ?`)
        .all(userId, userId) as Array<{ id: number }>
      if (friendIds.length === 0) {
        posts = []
      } else {
        const placeholders = friendIds.map(() => '?').join(',')
        posts = stmtCache
          .get(`SELECT p.id, p.userId, p.content, p.imageUrl,
                     CASE WHEN instr(p.createdAt, 'T') THEN p.createdAt ELSE p.createdAt || 'Z' END AS createdAt,
                     u.username, u.avatar, u.bio, u.gender, u.region, u.isOfficial,
                     (SELECT COUNT(*) FROM comments WHERE postId = p.id) AS commentCount
               FROM posts p
               JOIN users u ON p.userId = u.id
               WHERE u.active = 1 AND p.userId IN (${placeholders})
               ORDER BY p.createdAt DESC
               LIMIT 50`)
          .all(...friendIds.map(f => f.id)) as any[]
      }
    } else {
      // 广场（全部，排除官方帖子）
      posts = stmtCache
        .get(`SELECT p.id, p.userId, p.content, p.imageUrl,
                   CASE WHEN instr(p.createdAt, 'T') THEN p.createdAt ELSE p.createdAt || 'Z' END AS createdAt,
                   u.username, u.avatar, u.bio, u.gender, u.region, u.isOfficial,
                   (SELECT COUNT(*) FROM comments WHERE postId = p.id) AS commentCount
             FROM posts p
             JOIN users u ON p.userId = u.id
             WHERE u.active = 1 AND (u.isOfficial IS NULL OR u.isOfficial = 0)
             ORDER BY p.createdAt DESC
             LIMIT 50`)
        .all() as any[]
    }
    res.json({ success: true, posts })
  } catch (error: any) {
    console.error('[posts]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

router.post('/', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const { content, imageUrl } = req.body
    if (!content?.trim() && !imageUrl) {
      res.status(400).json({ success: false, error: '内容或图片不能为空' })
      return
    }
    const now = new Date().toISOString()
    const result = stmtCache
      .get('INSERT INTO posts (userId, content, imageUrl, createdAt) VALUES (?, ?, ?, ?)')
      .run(userId, content?.trim() || '', imageUrl || '', now)

    const post = stmtCache
      .get(`SELECT p.id, p.userId, p.content, p.imageUrl, p.createdAt,
                 u.username, u.avatar, u.bio, u.gender, u.region, 0 AS commentCount
           FROM posts p
           JOIN users u ON p.userId = u.id
           WHERE p.id = ?`)
      .get(result.lastInsertRowid)
    res.json({ success: true, post })
  } catch (error: any) {
    console.error('[posts-post]', error?.message || error)
    res.status(500).json({ success: false, error: '发布失败' })
  }
})

router.get('/:id/comments', authMiddleware, (req: Request, res: Response): void => {
  try {
    const postId = parseInt(req.params.id as string)
    const comments = stmtCache
      .get(`SELECT c.id, c.postId, c.userId, c.content,
                 CASE WHEN instr(c.createdAt, 'T') THEN c.createdAt ELSE c.createdAt || 'Z' END AS createdAt,
                 u.username, u.avatar, u.bio, u.gender, u.region
           FROM comments c
           JOIN users u ON c.userId = u.id
           WHERE c.postId = ?
           ORDER BY c.createdAt ASC`)
      .all(postId) as any[]
    res.json({ success: true, comments })
  } catch (error: any) {
    console.error('[posts-comments]', error?.message || error)
    res.status(500).json({ success: false, error: '服务器内部错误' })
  }
})

router.post('/:id/comments', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const postId = parseInt(req.params.id as string)
    const { content } = req.body

    if (!content?.trim()) {
      res.status(400).json({ success: false, error: '评论内容不能为空' })
      return
    }

    const post = stmtCache
      .get('SELECT p.id, p.userId, u.active FROM posts p JOIN users u ON p.userId = u.id WHERE p.id = ?')
      .get(postId) as any
    if (!post) {
      res.status(404).json({ success: false, error: '动态不存在' })
      return
    }

    const now = new Date().toISOString()
    const result = stmtCache
      .get('INSERT INTO comments (postId, userId, content, createdAt) VALUES (?, ?, ?, ?)')
      .run(postId, userId, content.trim(), now)

    const comment = stmtCache
      .get(`SELECT c.id, c.postId, c.userId, c.content, c.createdAt,
                 u.username, u.avatar, u.bio, u.gender, u.region
           FROM comments c
           JOIN users u ON c.userId = u.id
           WHERE c.id = ?`)
      .get(result.lastInsertRowid)
    res.json({ success: true, comment, postUserId: post.userId })
  } catch (error: any) {
    console.error('[posts-comments-post]', error?.message || error)
    res.status(500).json({ success: false, error: '评论失败' })
  }
})

router.delete('/:id', authMiddleware, (req: Request, res: Response): void => {
  try {
    const userId = (req as any).user.id
    const postId = parseInt(req.params.id as string)

    const post = stmtCache.get('SELECT userId FROM posts WHERE id = ?').get(postId) as any
    if (!post) {
      res.status(404).json({ success: false, error: '动态不存在' })
      return
    }
    if (post.userId !== userId) {
      res.status(403).json({ success: false, error: '只能删除自己的动态' })
      return
    }

    const del = db.transaction(() => {
      stmtCache.get('DELETE FROM comments WHERE postId = ?').run(postId)
      stmtCache.get('DELETE FROM posts WHERE id = ?').run(postId)
    })
    del()
    res.json({ success: true })
  } catch (error: any) {
    console.error('[posts-delete]', error?.message || error)
    res.status(500).json({ success: false, error: '删除失败' })
  }
})

export default router
