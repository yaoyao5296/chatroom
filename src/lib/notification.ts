/**
 * 浏览器/Capacitor 通知工具
 * Android 原生 App 使用 @capacitor/local-notifications（后台也能推送）
 * 浏览器使用 Notification API
 */
import { isAndroid, isNativeApp } from './platform'

let permissionRequested = false
let permissionGranted = false
let localNotifPlugin: any = null

// 尝试加载 Capacitor 本地通知插件
async function getLocalNotif() {
  if (localNotifPlugin !== null) return localNotifPlugin
  if (!isNativeApp() || !isAndroid()) {
    localNotifPlugin = false
    return null
  }
  try {
    const mod = await import('@capacitor/local-notifications')
    localNotifPlugin = mod.LocalNotifications
    return mod.LocalNotifications
  } catch {
    localNotifPlugin = false
    return null
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false

  // Android 原生应用：使用 Capacitor 本地通知
  if (isNativeApp() && isAndroid()) {
    const LN = await getLocalNotif()
    if (LN) {
      try {
        const { display } = await LN.requestPermissions()
        if (display === 'granted') {
          await LN.createChannel({
            id: 'chat_messages',
            name: '新消息',
            description: '私聊和群聊消息通知',
            importance: 4,
            visibility: 1,
            sound: 'default',
          })
          await LN.createChannel({
            id: 'chat_requests',
            name: '好友请求',
            description: '好友和群聊邀请',
            importance: 4,
            visibility: 1,
            sound: 'default',
          })
          permissionGranted = true
          return true
        }
      } catch (e) {
        console.log('[通知] Capacitor 插件初始化失败，使用浏览器通知')
      }
    }
    // 降级到浏览器通知
    permissionGranted = true
    return true
  }

  // 浏览器环境
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') { permissionGranted = true; return true }
  if (Notification.permission === 'denied') return false
  if (permissionRequested) return false

  permissionRequested = true
  try {
    const result = await Notification.requestPermission()
    permissionGranted = result === 'granted'
    return permissionGranted
  } catch { return false }
}

export async function showNotification(
  title: string,
  options?: NotificationOptions & { onClick?: () => void; channelId?: string }
) {
  if (typeof window === 'undefined') return

  // Android 原生：优先使用 Capacitor 本地通知（后台也能推送）
  if (isNativeApp() && isAndroid()) {
    const LN = await getLocalNotif()
    if (LN) {
      try {
        await LN.schedule({
          notifications: [{
            id: Date.now(),
            title,
            body: (options as any)?.body || '',
            channelId: (options as any)?.channelId || 'chat_messages',
            smallIcon: 'ic_launcher',
            extra: { timestamp: Date.now() },
          }],
        })
        return
      } catch { /* 降级 */ }
    }
  }

  // 浏览器 Notification API
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const { onClick, ...notificationOptions } = options || {}
    const n = new Notification(title, {
      icon: '/vite.svg',
      badge: '/vite.svg',
      tag: 'chat-message',
      ...(notificationOptions as any),
    })
    if (onClick) {
      n.onclick = () => { window.focus(); onClick(); n.close() }
    }
    setTimeout(() => n.close(), 5000)
    return n
  } catch (err) { /* 静默 */ }
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function isNotificationGranted(): boolean {
  if (isNativeApp() && isAndroid()) return true
  return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
}
