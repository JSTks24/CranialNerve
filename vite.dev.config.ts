import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = fileURLToPath(new URL('./', import.meta.url))

export default defineConfig({
  root: path.resolve(__dirname, 'dev'),
  plugins: [vue()],
  resolve: {
    alias: {
      '@core/session': path.resolve(__dirname, 'dev/mock-session.ts'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@db': path.resolve(__dirname, 'src/db'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@ui': path.resolve(__dirname, 'src/ui')
    }
  },
  server: {
    port: 5174,
    open: true
  }
})
