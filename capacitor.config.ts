import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.chatroom.app',
  appName: 'ChatRoom',
  webDir: 'dist',
  // Android 客户端加载本地 dist 资源
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: ['*']
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
    // Android 键盘不遮挡输入框
    resizeOnFullScreen: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0F172A',
      showSpinner: false
    },
    Keyboard: {
      resize: 'body',
      style: 'dark'
    }
  }
}

export default config
