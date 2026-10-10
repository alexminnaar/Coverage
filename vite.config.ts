import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ai-api': {
        target: process.env.VITE_AI_API_TARGET || 'http://localhost:3002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ai-api/, '/api'),
      },
    },
  },
})

