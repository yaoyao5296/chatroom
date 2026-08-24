/**
 * Android / Capacitor 平台集成
 * - 处理 Android 返回键
 * - 处理键盘事件
 * - 处理生命周期
 */

import { isNativeApp } from './platform'

let backButtonHandler: (() => boolean) | null = null

/**
 * 注册 Android 返回键处理器
 * 返回 true 表示已处理（阻止默认行为），false 继续传递
 */
export function setBackButtonHandler(handler: (() => boolean) | null) {
  backButtonHandler = handler
}

/**
 * 初始化 Android 平台适配
 */
export function initAndroidPlatform() {
  if (typeof window === 'undefined') return

  // 监听 Capacitor 返回按钮事件
  if (isNativeApp() && window.Capacitor) {
    try {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('backButton', ({ canGoBack }) => {
          if (backButtonHandler) {
            const handled = backButtonHandler()
            if (handled) return
          }
          if (!canGoBack) {
            App.exitApp()
          }
        })
      }).catch(() => {
        // @capacitor/app 未安装，忽略
      })
    } catch {}
  }

  // 全局触摸反馈 - Android 点击波纹
  document.addEventListener('touchstart', () => {}, { passive: true })

  // 防止 Android 双击缩放
  let lastTouchEnd = 0
  document.addEventListener('touchend', (e) => {
    const now = Date.now()
    if (now - lastTouchEnd <= 300) {
      e.preventDefault()
    }
    lastTouchEnd = now
  }, { passive: false })
}