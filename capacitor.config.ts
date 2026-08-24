import { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.chatroom.app',
  appName: 'ChatRoom',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true
  }
};
export default config;
