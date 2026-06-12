import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.chatroom.app',
  appName: 'ChatRoom',
  webDir: 'dist',
  server: {
    url: '',
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
}

export default config