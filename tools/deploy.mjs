import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const DEPLOY_TARGET =
  process.env.CN_DEPLOY_TARGET ||
  'C:/Program_ForUser/SillyTavern/public/scripts/extensions/third-party/CranialNerve'

const manifestSrc = path.join(projectRoot, 'manifest.json')
const distSrc = path.join(projectRoot, 'dist')

if (!existsSync(distSrc)) {
  console.error('[CranialNerve deploy] dist/ 不存在，请先执行 vite build')
  process.exit(1)
}
if (!existsSync(manifestSrc)) {
  console.error('[CranialNerve deploy] manifest.json 不存在')
  process.exit(1)
}
const promptsSrc = path.join(projectRoot, 'prompts')
const tablesSrc = path.join(projectRoot, 'tables')

rmSync(DEPLOY_TARGET, { recursive: true, force: true })
mkdirSync(DEPLOY_TARGET, { recursive: true })

copyFileSync(manifestSrc, path.join(DEPLOY_TARGET, 'manifest.json'))
cpSync(distSrc, path.join(DEPLOY_TARGET, 'dist'), { recursive: true })
if (existsSync(promptsSrc)) {
  cpSync(promptsSrc, path.join(DEPLOY_TARGET, 'prompts'), { recursive: true })
}
if (existsSync(tablesSrc)) {
  cpSync(tablesSrc, path.join(DEPLOY_TARGET, 'tables'), { recursive: true })
}

console.log(`[CranialNerve deploy] 已部署到 ${DEPLOY_TARGET}`)
