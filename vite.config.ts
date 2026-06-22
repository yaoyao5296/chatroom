import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths"
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    traeBadgePlugin({
      variant: 'dark',
      position: 'bottom-right',
      prodOnly: true,
      clickable: true,
      clickUrl: 'https://www.trae.ai/solo?showJoin=1',
      autoTheme: true,
      autoThemeTarget: '#root'
    }),
    tsconfigPaths(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        proxyTimeout: 30000,
        timeout: 30000,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    chunkSizeWarningLimit: 500,
    // 代码分割：分离大依赖到独立 chunk，让浏览器缓存更好
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心：最稳定，最适合长期缓存
          'react-core': ['react', 'react-dom', 'react-router-dom'],
          // 状态管理
          'state': ['zustand'],
          // 图标库（体积较大，单独 chunk）
          'icons': ['lucide-react'],
          // 工具类（clsx + tailwind-merge 小而稳）
          'utils': ['clsx', 'tailwind-merge'],
          // Socket.IO
          'socket': ['socket.io-client'],
        },
      },
    },
  },
  // 预构建依赖，减少运行时开销
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'zustand', 'lucide-react', 'socket.io-client'],
  },
})
