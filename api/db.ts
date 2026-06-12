/**
 * SQLite 数据库初始化
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dbPath = path.join(__dirname, '..', 'data', 'chat.db')

// 确保 data 目录存在
const dataDir = path.dirname(dbPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const db = new Database(dbPath)

// 启用 WAL 模式提升性能
db.pragma('journal_mode = WAL')

// 创建表（兼容旧表结构，使用 IF NOT EXISTS 和 ALTER TABLE）
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER NOT NULL,
    receiverId INTEGER NOT NULL,
    content TEXT DEFAULT '',
    type TEXT DEFAULT 'text',
    fileUrl TEXT DEFAULT '',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (senderId) REFERENCES users(id),
    FOREIGN KEY (receiverId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    friendId INTEGER NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id),
    FOREIGN KEY (friendId) REFERENCES users(id),
    UNIQUE(userId, friendId)
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'register',
    expiresAt DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(senderId);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiverId);
  CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(userId);
  CREATE INDEX IF NOT EXISTS idx_verification_target ON verification_codes(target);
`)

// 兼容旧表：添加 phone/email/active 列（如果不存在）
try {
  db.exec(`ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1`)
} catch { /* 列已存在 */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN deactivatedAt DATETIME DEFAULT NULL`)
} catch { /* 列已存在 */ }

// 修复：确保所有现有用户的 active 不为 NULL（兼容旧数据库升级）
db.exec(`UPDATE users SET active = 1 WHERE active IS NULL`)

export default db