import { setDefaultPrompts, type RawSegment } from '@shared/prompts/defaults'
import { pushLog } from '@shared/log-buffer'

let loaded = false
let loadingPromise: Promise<void> | null = null

function promptUrl(name: string): string {
  const href = new URL(import.meta.url).href
  const dir = href.slice(0, href.lastIndexOf('/'))
  return `${dir}/../prompts/${name}.json`
}

export async function loadDefaultPrompts(): Promise<void> {
  if (loaded) return
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    try {
      const [te, cg, cr] = await Promise.all([
        fetch(promptUrl('tableEdit')).then((r) => r.json()),
        fetch(promptUrl('chronicleGen')).then((r) => r.json()),
        fetch(promptUrl('chronicleRecall')).then((r) => r.json())
      ])
      setDefaultPrompts(te as RawSegment[], cg as RawSegment[], cr as RawSegment[])
      loaded = true
    } catch (e) {
      pushLog('error', 'prompt', `默认提示词加载失败（下次将重试）: ${e instanceof Error ? e.message : String(e)}`)
      loadingPromise = null
    }
  })()
  return loadingPromise
}
