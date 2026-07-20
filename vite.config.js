import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: {
    port: 5200,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8800',
      '/auth': 'http://localhost:8800',
    },
  },
})
