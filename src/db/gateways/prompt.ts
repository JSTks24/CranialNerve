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
      const [te, cr] = await Promise.all([
        fetch(promptUrl('tableEdit')).then((r) => r.json()),
        fetch(promptUrl('chronicleRecall')).then((r) => r.json())
      ])
      setDefaultPrompts(te as RawSegment[], cr as RawSegment[])
    } catch (e) {
      pushLog('error', 'prompt', `默认提示词加载失败: ${e instanceof Error ? e.message : String(e)}`)
    }
    loaded = true
  })()
  return loadingPromise
}
