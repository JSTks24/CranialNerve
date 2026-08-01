import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const wasmSrc = path.resolve(here, '../node_modules/sql.js/dist/sql-wasm.wasm')
const wasmDestDir = path.resolve(here, '../src/db/sqlite/assets')
const wasmDest = path.resolve(wasmDestDir, 'sql-wasm.wasm')

export default function setup() {
  if (!existsSync(wasmDestDir)) mkdirSync(wasmDestDir, { recursive: true })
  copyFileSync(wasmSrc, wasmDest)
  return () => {
    if (existsSync(wasmDestDir)) rmSync(wasmDestDir, { recursive: true, force: true })
  }
}
