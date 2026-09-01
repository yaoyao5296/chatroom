import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
    chunkSizeWarningLimit: 300,
    // 减少 CSS 文件大小
    cssCodeSplit: true,
    // 关闭 brotli 大小报告（减少构建时间）
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // 更细粒度的代码分割
        manualChunks(id) {
          // 第三方库
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
            return 'react-core'
          }
          if (id.includes('node_modules/zustand')) return 'state'
          if (id.includes('node_modules/lucide-react')) return 'icons'
          if (id.includes('node_modules/clsx') || id.includes('node_modules/tailwind-merge')) return 'utils'
          if (id.includes('node_modules/socket.io-client')) return 'socket'
          // 按页面模块拆分，每个页面独立 chunk
          if (id.includes('/src/pages/')) {
            const match = id.match(/\/src\/pages\/(\w+)\.(tsx|ts)$/)
            if (match) return `page-${match[1]}`
          }
          // 组件模块拆分
          if (id.includes('/src/components/')) {
            const match = id.match(/\/src\/components\/(\w+)\.(tsx|ts)$/)
            if (match) return `comp-${match[1]}`
          }
        },
      },
    },
  },
  // 预构建依赖，减少运行时开销
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'zustand', 'lucide-react', 'socket.io-client'],
  },
})
