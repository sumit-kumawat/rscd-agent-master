import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))

/** Docker app publishes backend on APP_PORT (default 8080). Avoid :5000 on macOS (AirPlay). */
const devApiTarget = process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: process.env.DOCKER_BUILD ? 'dist' : path.resolve(dir, '../backend/public'),
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.VITE_DEV_PORT) || 3000,
    strictPort: false,
    proxy: {
      '/api': { target: devApiTarget, changeOrigin: true },
      '/socket.io': { target: devApiTarget, ws: true },
      '/health': { target: devApiTarget, changeOrigin: true },
      '/ready': { target: devApiTarget, changeOrigin: true },
    },
  },
})
