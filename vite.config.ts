import { defineConfig, type Plugin } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'

const __dirname = fileURLToPath(new URL('./', import.meta.url))

function copyStaticAssets(): Plugin {
  return {
    name: 'copy-static-assets',
    writeBundle() {
      const distDir = path.resolve(__dirname, 'dist')
      const wasmSrc = path.resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm')
      const wasmDestDir = path.resolve(distDir, 'assets')
      if (existsSync(wasmSrc)) {
        mkdirSync(wasmDestDir, { recursive: true })
        copyFileSync(wasmSrc, path.resolve(wasmDestDir, 'sql-wasm.wasm'))
      }
    }
  }
}

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.platform': JSON.stringify('browser'),
    'process.version': JSON.stringify('')
  },
  plugins: [vue(), copyStaticAssets()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@db': path.resolve(__dirname, 'src/db'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@ui': path.resolve(__dirname, 'src/ui')
    }
  },
  build: {
    target: 'es2022',
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'CranialNerve',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      output: {
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    },
    minify: false,
    sourcemap: true,
    emptyOutDir: true
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts']
  }
})
