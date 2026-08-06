import type { CardTemplate } from '@shared/types/card'
import type { TableDef } from '@shared/types/table'
import type { TableTemplatePreset } from '@shared/types/config'
import { DEFAULT_TEMPLATE_PRESET_ID } from '@shared/constants/default-template'
import { pushLog } from '@shared/log-buffer'

let defaultTemplate: CardTemplate | null = null
let chronicleTable: TableDef | null = null
let loadingPromise: Promise<void> | null = null

function templateUrl(name: string): string {
  const href = new URL(import.meta.url).href
  const dir = href.slice(0, href.lastIndexOf('/'))
  return `${dir}/../tables/${name}.json`
}

export async function loadDefaultTemplate(): Promise<void> {
  if (defaultTemplate && chronicleTable) return
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    try {
      const [tpl, chr] = await Promise.all([
        fetch(templateUrl('default-template')).then((r) => r.json()),
        fetch(templateUrl('chronicle')).then((r) => r.json())
      ])
      defaultTemplate = tpl as CardTemplate
      chronicleTable = chr as TableDef
    } catch (e) {
      pushLog('error', 'template', `默认表格模板加载失败（下次将重试）: ${e instanceof Error ? e.message : String(e)}`)
      loadingPromise = null
    }
  })()
  return loadingPromise
}

export function getDefaultTemplate(): CardTemplate | null {
  return defaultTemplate
}

export function getDefaultChronicleTable(): TableDef | null {
  return chronicleTable
}

export function createDefaultTemplatePreset(): TableTemplatePreset {
  const tpl = getDefaultTemplate()
  return {
    id: DEFAULT_TEMPLATE_PRESET_ID,
    name: '默认模板',
    template: tpl ? (JSON.parse(JSON.stringify(tpl)) as CardTemplate) : { templateVersion: 1, tables: [] },
    source: 'builtin'
  }
}
