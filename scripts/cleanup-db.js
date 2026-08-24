/**
 * 数据库清理脚本 - 清除所有用户数据
 * 可手动运行: node scripts/cleanup-db.js
 * 或通过定时任务自动运行
 */
const Database = require('better-sqlite3')
const path = require('path')

const dbPath = path.join(__dirname, '..', 'data', 'chat.db')
const db = new Database(dbPath)

try {
  db.exec('DELETE FROM friendships')
  db.exec('DELETE FROM messages')
  db.exec('DELETE FROM verification_codes')
  db.exec('DELETE FROM users')
  console.log(`[${new Date().toISOString()}] 数据库已清理: 所有用户数据已清除`)
} catch (err) {
  console.error('清理失败:', err.message)
  process.exit(1)
}