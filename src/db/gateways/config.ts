import type {
  AiPreset,
  ChronicleTableHints,
  CranialNerveConfig,
  PromptConfig,
  PromptSceneKey,
  PromptSegment,
  ScenePreset,
  ScenePromptConfig,
  TableTemplateConfig
} from '@shared/types/config'
import type { CardTemplate } from '@shared/types/card'
import type { TableDef } from '@shared/types/table'
import {
  getDefaultChronicleGenPrompt,
  getDefaultChronicleRecallPrompt,
  getDefaultTableEditPrompt
} from '@shared/prompts/defaults'
import { DEFAULT_TEMPLATE_PRESET_ID } from '@shared/constants/default-template'
import { getDefaultChronicleTable, createDefaultTemplatePreset } from './template'
import { getHostContext, getRequestHeaders } from './host-context'
import { pushLog } from '@shared/log-buffer'

const CONFIG_KEY = 'cranialnerve'

function newId(): string {
  return `seg_${Math.random().toString(36).slice(2, 10)}`
}

function cloneSegments(segments: PromptSegment[]): PromptSegment[] {
  return segments.map((s) => ({ ...s }))
}

function presetFromSegments(segments: PromptSegment[], name = '默认'): ScenePreset {
  return {
    id: `preset_${Math.random().toString(36).slice(2, 10)}`,
    name,
    segments: cloneSegments(segments)
  }
}

function sceneFromSegments(segments: PromptSegment[]): ScenePromptConfig {
  const preset = presetFromSegments(segments)
  return { presets: [preset], activeId: preset.id, defaultId: preset.id }
}

function defaultPromptConfig(): PromptConfig {
  return {
    tableEdit: sceneFromSegments(getDefaultTableEditPrompt()),
    chronicleGen: sceneFromSegments(getDefaultChronicleGenPrompt()),
    chronicleRecall: sceneFromSegments(getDefaultChronicleRecallPrompt())
  }
}

const DEFAULT_CONFIG: CranialNerveConfig = {
  aiPresets: [],
  activeAiPresetId: '',
  vector: {
    embeddingEndpoint: '',
    embeddingApiKey: '',
    embeddingModel: '',
    rerankEndpoint: '',
    rerankApiKey: '',
    rerankModel: ''
  },
  vectorEnabled: false,
  snapshotStrategy: 'every-message',
  prompt: defaultPromptConfig(),
  tableFill: {
    autoFillTrigger: 'after-ai',
    regenerateFill: true,
    contextDepth: 3,
    updateFrequency: 1,
    batchSize: 10,
    skipFloors: 0,
    maxRetries: 3,
    manualUpdateContextDepth: null,
    manualUpdateBatchSize: null,
    manualSelectedTables: [],
    manualIncludeChronicle: false
  },
  chronicleFill: {
    autoFillTrigger: 'after-ai',
    regenerateFill: true,
    contextDepth: 3,
    updateFrequency: 1,
    batchSize: 10,
    skipFloors: 0,
    maxRetries: 3,
    chronicleSendLatestRows: 10,
    manualUpdateContextDepth: null,
    manualUpdateBatchSize: null
  },
  maxRecallItems: 25,
  recallEnabled: true,
  recallRecentFixedInjectCount: 5,
  recallMinScore: 0.45,
  tableFillPresetId: '',
  chronicleGenPresetId: '',
  recallPresetId: '',
  recallContextDepth: 5,
  retainFloors: 100,
  checkpointInterval: 20,
  pending: {
    aiCallTimeoutMs: 0,
    aiTimeoutRetries: 1,
    listModelsTimeoutMs: 10000,
    writeQueueDrainTimeoutMs: 8000,
    summarizeOnManualAbort: false,
    minSummaryLength: 100
  },
  tableTemplate: {
    presets: [createDefaultTemplatePreset()],
    activeId: DEFAULT_TEMPLATE_PRESET_ID,
    defaultId: DEFAULT_TEMPLATE_PRESET_ID
  }
}

export interface ConfigGateway {
  read(): CranialNerveConfig
  write(config: CranialNerveConfig): boolean
  flush(): boolean
  listModels(preset: AiPreset, timeoutMs?: number): Promise<string[]>
}

export default function createConfigGateway(): ConfigGateway {
  return {
    read() {
      const raw = getHostContext().extensionSettings[CONFIG_KEY]
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return cloneDefault()
      }
      const merged = { ...cloneDefault(), ...(raw as Partial<CranialNerveConfig>) }
      merged.aiPresets = (merged.aiPresets ?? []).map((p) => ({ ...p, responseFormat: p.responseFormat ?? 'none' }))
      merged.vector = { ...DEFAULT_CONFIG.vector, ...merged.vector }
      merged.pending = { ...DEFAULT_CONFIG.pending, ...merged.pending }
      merged.tableFill = { ...DEFAULT_CONFIG.tableFill, ...merged.tableFill }
      merged.chronicleFill = { ...DEFAULT_CONFIG.chronicleFill, ...merged.chronicleFill }
      const rawObj = raw as Record<string, unknown>
      if (rawObj.chronicleGenEnabled !== undefined && rawObj.chronicleFill === undefined) {
        merged.chronicleFill.autoFillTrigger = rawObj.chronicleGenEnabled ? 'after-ai' : 'off'
      }
      merged.prompt = migratePrompt(merged.prompt, raw as Record<string, unknown>)
      merged.tableTemplate = migrateTableTemplate(merged.tableTemplate)
      merged.chronicleTableDef = migrateChronicleTableDef(merged.chronicleTableDef, merged.chronicleTableHints)
      if (rawObj.promptPresets !== undefined || rawObj.activePromptPresetId !== undefined) {
        delete rawObj.promptPresets
        delete rawObj.activePromptPresetId
        const saveCtx = getHostContext()
        if (typeof saveCtx.saveSettingsDebounced === 'function') {
          saveCtx.saveSettingsDebounced()
        }
      }
      return merged
    },
    write(config) {
      getHostContext().extensionSettings[CONFIG_KEY] = config
      const ctx = getHostContext()
      if (typeof ctx.saveSettingsDebounced === 'function') {
        ctx.saveSettingsDebounced()
        return true
      }
      pushLog('error', 'config', 'saveSettingsDebounced 不可用，配置改动不会被持久化')
      return false
    },
    flush() {
      const ctx = getHostContext() as unknown as Record<string, unknown>
      if (typeof ctx.saveSettings === 'function') {
        (ctx as { saveSettings: () => void }).saveSettings()
        return true
      }
      pushLog('error', 'config', 'saveSettings 不可用，配置改动不会被持久化')
      return false
    },
    async listModels(preset, timeoutMs) {
      if (!preset.baseURL) {
        return []
      }
      const headers = getRequestHeaders()
      headers['Content-Type'] = 'application/json'
      const safeKey = preset.apiKey.replace(/[\r\n]/g, '')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs ?? 10000)
      try {
        const res = await fetch('/api/backends/chat-completions/status', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: preset.baseURL,
            custom_include_headers: safeKey
              ? `Authorization: Bearer ${safeKey}`
              : '',
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: boolean; message?: string }
          throw new Error(err.message || `获取模型列表失败：${res.status}`)
        }
        const data = (await res.json()) as { data?: Array<{ id: string }> }
        return Array.isArray(data.data) ? data.data.map((m) => m.id) : []
      } finally {
        clearTimeout(timer)
      }
    }
  }
}

function cloneDefault(): CranialNerveConfig {
  return {
    ...DEFAULT_CONFIG,
    aiPresets: [],
    vector: { ...DEFAULT_CONFIG.vector },
    prompt: clonePromptConfig(defaultPromptConfig()),
    tableFill: { ...DEFAULT_CONFIG.tableFill },
    chronicleFill: { ...DEFAULT_CONFIG.chronicleFill },
    pending: { ...DEFAULT_CONFIG.pending },
    tableTemplate: cloneTableTemplate({ presets: [createDefaultTemplatePreset()], activeId: DEFAULT_TEMPLATE_PRESET_ID, defaultId: DEFAULT_TEMPLATE_PRESET_ID })
  }
}

function clonePromptConfig(p: PromptConfig): PromptConfig {
  return {
    tableEdit: cloneScene(p.tableEdit),
    chronicleGen: cloneScene(p.chronicleGen),
    chronicleRecall: cloneScene(p.chronicleRecall)
  }
}

function cloneScene(s: ScenePromptConfig): ScenePromptConfig {
  return {
    presets: s.presets.map((p) => ({
      ...p,
      segments: cloneSegments(p.segments)
    })),
    activeId: s.activeId,
    defaultId: s.defaultId
  }
}

function migratePrompt(
  current: PromptConfig | undefined,
  raw: Record<string, unknown>
): PromptConfig {
  const base = clonePromptConfig(defaultPromptConfig())
  if (!current || typeof current !== 'object') {
    return migrateFromLegacy(raw, base)
  }
  const merged: PromptConfig = {
    tableEdit: mergeScene(base.tableEdit, migrateScene(current.tableEdit)),
    chronicleGen: mergeScene(base.chronicleGen, migrateScene(current.chronicleGen)),
    chronicleRecall: mergeScene(base.chronicleRecall, migrateScene(current.chronicleRecall))
  }
  return migrateFromLegacy(raw, merged)
}

function migrateScene(scene: unknown): ScenePromptConfig {
  if (!scene || typeof scene !== 'object') {
    return { presets: [], activeId: '', defaultId: '' }
  }
  const s = scene as { presets?: unknown[]; activeId?: unknown; defaultId?: unknown }
  return {
    presets: Array.isArray(s.presets) ? s.presets.map(migratePreset) : [],
    activeId: typeof s.activeId === 'string' ? s.activeId : '',
    defaultId: typeof s.defaultId === 'string' ? s.defaultId : ''
  }
}

function migratePreset(p: unknown): ScenePreset {
  if (!p || typeof p !== 'object') {
    return { id: `preset_${Math.random().toString(36).slice(2, 10)}`, name: '默认', segments: [] }
  }
  const preset = p as {
    id?: unknown
    name?: unknown
    segments?: PromptSegment[]
    blocks?: { name: string; segments: PromptSegment[] }[]
  }
  let segments: PromptSegment[]
  if (Array.isArray(preset.segments)) {
    segments = preset.segments.map((s) => ({
      id: typeof s.id === 'string' ? s.id : newId(),
      name: typeof s.name === 'string' ? s.name : '',
      role: s.role,
      content: s.content
    }))
  } else if (Array.isArray(preset.blocks)) {
    segments = []
    for (const b of preset.blocks) {
      if (!b || !Array.isArray(b.segments)) continue
      for (const s of b.segments) {
        segments.push({
          id: s.id || newId(),
          name: b.name,
          role: s.role,
          content: s.content
        })
      }
    }
  } else {
    segments = []
  }
  return {
    id: typeof preset.id === 'string' ? preset.id : `preset_${Math.random().toString(36).slice(2, 10)}`,
    name: typeof preset.name === 'string' ? preset.name : '默认',
    segments
  }
}

function mergeScene(
  base: ScenePromptConfig,
  cur: ScenePromptConfig | undefined
): ScenePromptConfig {
  if (!cur || !Array.isArray(cur.presets) || cur.presets.length === 0) {
    return base
  }
  const merged = cloneScene(cur)
  if (!merged.presets.find((p) => p.id === merged.defaultId)) {
    merged.defaultId = merged.presets[0]!.id
  }
  if (!merged.presets.find((p) => p.id === merged.activeId)) {
    merged.activeId = merged.presets[0]!.id
  }
  return merged
}

function migrateFromLegacy(raw: Record<string, unknown>, base: PromptConfig): PromptConfig {
  const legacyPresets = raw.promptPresets
  const activeId = raw.activePromptPresetId
  if (!Array.isArray(legacyPresets) || legacyPresets.length === 0) {
    return base
  }
  const active =
    legacyPresets.find(
      (p) => p && typeof p === 'object' && (p as { id?: string }).id === activeId
    ) ?? legacyPresets[0]
  const templates = (active as { templates?: Record<string, unknown> })?.templates
  if (!templates || typeof templates !== 'object') {
    return base
  }
  const scenes: PromptSceneKey[] = ['tableEdit', 'chronicleGen', 'chronicleRecall']
  const result = clonePromptConfig(base)
  for (const key of scenes) {
    const segs = migrateField(templates[key])
    if (segs) {
      const preset = presetFromSegments(segs)
      result[key] = { presets: [preset], activeId: preset.id, defaultId: preset.id }
    }
  }
  return result
}

function migrateField(val: unknown): PromptSegment[] | null {
  if (Array.isArray(val)) {
    return (val as PromptSegment[]).map((s) => ({
      id: typeof s.id === 'string' ? s.id : newId(),
      name: typeof s.name === 'string' ? s.name : '',
      role: s.role,
      content: s.content
    }))
  }
  if (typeof val === 'string' && val.length > 0) {
    return [{ id: newId(), name: '主指令', role: 'system', content: val }]
  }
  return null
}

function cloneTableTemplate(t: TableTemplateConfig): TableTemplateConfig {
  return {
    presets: t.presets.map((p) => ({
      ...p,
      template: JSON.parse(JSON.stringify(p.template)) as CardTemplate
    })),
    activeId: t.activeId,
    defaultId: t.defaultId
  }
}

function migrateTableTemplate(cur: TableTemplateConfig | undefined): TableTemplateConfig {
  if (!cur || !Array.isArray(cur.presets) || cur.presets.length === 0) {
    return {
      presets: [createDefaultTemplatePreset()],
      activeId: DEFAULT_TEMPLATE_PRESET_ID,
      defaultId: DEFAULT_TEMPLATE_PRESET_ID
    }
  }
  const presets = [...cur.presets]
  const fallbackId = presets[0]?.id ?? DEFAULT_TEMPLATE_PRESET_ID
  let activeId = cur.activeId || fallbackId
  let defaultId = cur.defaultId || fallbackId
  if (!presets.find((p) => p.id === activeId)) {
    activeId = fallbackId
  }
  if (!presets.find((p) => p.id === defaultId)) {
    defaultId = fallbackId
  }
  return { presets, activeId, defaultId }
}

function migrateChronicleTableDef(
  cur: TableDef | undefined,
  legacyHints: ChronicleTableHints | undefined
): TableDef {
  const defaultChronicle = getDefaultChronicleTable() ?? { name: 'cn_chronicle', displayName: '纪要表', columns: [] }
  const base = legacyHints ? { ...defaultChronicle, ...legacyHints } : defaultChronicle
  if (cur && Array.isArray(cur.columns) && cur.columns.length > 0) {
    const hasLegacy = cur.columns.some((c) => typeof c.displayName === 'string' && c.displayName.includes('台词'))
    if (hasLegacy) {
      return JSON.parse(JSON.stringify(base)) as TableDef
    }
    return cur
  }
  return JSON.parse(JSON.stringify(base)) as TableDef
}
