import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initAndroidPlatform } from './lib/android'
import { preloadModels } from './lib/face'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 初始化 Android 平台适配
initAndroidPlatform()

// 预加载人脸识别模型（后台加载，不阻塞渲染）
preloadModels()
