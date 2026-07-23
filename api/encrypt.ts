/**
 * 数据库文件加密/解密工具
 * 使用 AES-256-GCM 对 SQLite 数据库文件进行加密存储
 * 
 * 加密文件格式：
 *   [magic: 13B] + [salt: 32B] + [iv: 16B] + [authTag: 16B] + [ciphertext]
 * 
 * 启动时自动解密，关闭时自动加密
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DB_PATH = path.join(__dirname, '..', 'data', 'chat.db')
const ENC_PATH = DB_PATH + '.enc'

const MAGIC = Buffer.from('CHATROOM_ENC', 'utf8')  // 12 bytes
const VERSION = Buffer.from([1])                     // 1 byte
const HEADER = Buffer.concat([MAGIC, VERSION])       // 13 bytes
const SALT_LEN = 32
const IV_LEN = 16
const AUTH_TAG_LEN = 16
const KEY_LEN = 32 // AES-256

const PASSWORD = process.env.DB_ENCRYPT_KEY || 'sxx0425'

/**
 * 从密码派生 AES-256 密钥
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LEN, 'sha512')
}

/**
 * 检查数据库文件是否已加密
 */
export function isEncrypted(): boolean {
  if (!fs.existsSync(ENC_PATH)) return false
  try {
    const fd = fs.openSync(ENC_PATH, 'r')
    const buf = Buffer.alloc(HEADER.length)
    fs.readSync(fd, buf, 0, HEADER.length, 0)
    fs.closeSync(fd)
    return buf.equals(HEADER)
  } catch {
    return false
  }
}

/**
 * 解密数据库文件（同步）
 * 将 .db.enc 解密为 .db
 * 如果 .db 已存在且比 .db.enc 新，则跳过
 * 如果 .db.enc 不存在，则跳过
 */
export function decryptDatabase(): void {
  if (!fs.existsSync(ENC_PATH)) {
    // 没有加密文件，检查普通数据库是否存在
    if (fs.existsSync(DB_PATH)) {
      const stat = fs.statSync(DB_PATH)
      if (stat.size > 0) {
        console.log('[encrypt] 数据库未加密，直接使用')
      }
    }
    return
  }

  // 检查是否已解密（.db 比 .enc 新）
  if (fs.existsSync(DB_PATH)) {
    const dbStat = fs.statSync(DB_PATH)
    const encStat = fs.statSync(ENC_PATH)
    if (dbStat.mtimeMs >= encStat.mtimeMs) {
      console.log('[encrypt] 数据库已解密，跳过')
      return
    }
  }

  console.log('[encrypt] 正在解密数据库...')

  try {
    const encrypted = fs.readFileSync(ENC_PATH)

    // 验证 magic header
    const magic = encrypted.subarray(0, HEADER.length)
    if (!magic.equals(HEADER)) {
      throw new Error('加密文件格式无效或密码错误')
    }

    let offset = HEADER.length
    const salt = encrypted.subarray(offset, offset + SALT_LEN); offset += SALT_LEN
    const iv = encrypted.subarray(offset, offset + IV_LEN); offset += IV_LEN
    const authTag = encrypted.subarray(offset, offset + AUTH_TAG_LEN); offset += AUTH_TAG_LEN
    const ciphertext = encrypted.subarray(offset)

    const key = deriveKey(PASSWORD, salt)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    fs.writeFileSync(DB_PATH, decrypted)
    console.log('[encrypt] 数据库解密成功')
  } catch (err: any) {
    if (err.message?.includes('auth tag') || err.message?.includes('密码错误')) {
      console.error('[encrypt] 解密失败：密码错误或文件损坏')
    } else {
      console.error('[encrypt] 解密失败:', err.message)
    }
    throw err
  }
}

/**
 * 加密数据库文件（同步）
 * 将 .db 加密为 .db.enc
 * 成功后删除 .db 文件
 */
export function encryptDatabase(): void {
  if (!fs.existsSync(DB_PATH)) {
    console.log('[encrypt] 数据库文件不存在，跳过加密')
    return
  }

  console.log('[encrypt] 正在加密数据库...')

  try {
    const data = fs.readFileSync(DB_PATH)

    const salt = crypto.randomBytes(SALT_LEN)
    const iv = crypto.randomBytes(IV_LEN)
    const key = deriveKey(PASSWORD, salt)

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
    const authTag = cipher.getAuthTag()

    const output = Buffer.concat([HEADER, salt, iv, authTag, encrypted])
    fs.writeFileSync(ENC_PATH, output)

    // 删除原始数据库文件
    fs.unlinkSync(DB_PATH)

    // 也删除 WAL/SHM 文件
    try { fs.unlinkSync(DB_PATH + '-wal') } catch {}
    try { fs.unlinkSync(DB_PATH + '-shm') } catch {}

    console.log('[encrypt] 数据库加密成功')
  } catch (err: any) {
    console.error('[encrypt] 加密失败:', err.message)
  }
}