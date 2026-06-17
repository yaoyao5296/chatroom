import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.chatroom.app',
  appName: 'ChatRoom',
  webDir: 'dist',
  // Android 客户端加载本地 dist 资源（生产环境可配置 https 服务器地址）
  server: {
    url: '',
    cleartext: true,
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0F172A',
      showSpinner: false
    }
  }
}

export default config
