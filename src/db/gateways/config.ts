import type {
  AiPreset,
  CranialNerveConfig,
  PromptBlock,
  PromptConfig,
  PromptSceneKey,
  PromptSegment,
  ScenePreset,
  ScenePromptConfig
} from '@shared/types/config'
import {
  DEFAULT_CHRONICLE_GENERATE_PROMPT,
  DEFAULT_CHRONICLE_RECALL_PROMPT,
  DEFAULT_TABLE_EDIT_PROMPT
} from '@shared/prompts/defaults'
import { getHostContext, getRequestHeaders } from './host-context'
import { pushLog } from '@shared/log-buffer'

const CONFIG_KEY = 'cranialnerve'

function newId(): string {
  return `seg_${Math.random().toString(36).slice(2, 10)}`
}

function newBlockId(): string {
  return `blk_${Math.random().toString(36).slice(2, 10)}`
}

function cloneBlocks(blocks: PromptBlock[]): PromptBlock[] {
  return blocks.map((b) => ({
    ...b,
    segments: b.segments.map((s) => ({ ...s }))
  }))
}

function presetFromBlocks(blocks: PromptBlock[], name = '默认'): ScenePreset {
  return {
    id: `preset_${Math.random().toString(36).slice(2, 10)}`,
    name,
    blocks: cloneBlocks(blocks)
  }
}

function sceneFromBlocks(blocks: PromptBlock[]): ScenePromptConfig {
  const preset = presetFromBlocks(blocks)
  return { presets: [preset], activeId: preset.id, defaultId: preset.id }
}

function defaultPromptConfig(): PromptConfig {
  return {
    tableEdit: sceneFromBlocks(DEFAULT_TABLE_EDIT_PROMPT),
    chronicleRecall: sceneFromBlocks(DEFAULT_CHRONICLE_RECALL_PROMPT),
    chronicleGenerate: sceneFromBlocks(DEFAULT_CHRONICLE_GENERATE_PROMPT)
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
  maxRetries: 3,
  snapshotStrategy: 'every-message',
  prompt: defaultPromptConfig(),
  tableFill: {
    autoFill: true,
    contextDepth: 3,
    updateFrequency: 1,
    batchSize: 3,
    skipFloors: 0,
    groupId: -1,
    maxRetries: 3
  },
  maxRecallItems: 25,
  recallEnabled: true,
  chronicleGenEnabled: true,
  tableFillPresetId: '',
  recallPresetId: '',
  chronicleGenPresetId: '',
  recallContextDepth: 5,
  retainFloors: 100,
  tableTemplate: { presets: [], activeId: '', defaultId: '' }
}

export interface ConfigGateway {
  read(): CranialNerveConfig
  write(config: CranialNerveConfig): void
  flush(): void
  listModels(preset: AiPreset): Promise<string[]>
}

export default function createConfigGateway(): ConfigGateway {
  return {
    read() {
      const raw = getHostContext().extensionSettings[CONFIG_KEY]
      if (typeof raw !== 'object' || raw === null) {
        return cloneDefault()
      }
      const merged = { ...cloneDefault(), ...(raw as Partial<CranialNerveConfig>) }
      merged.vector = { ...DEFAULT_CONFIG.vector, ...merged.vector }
      merged.prompt = migratePrompt(merged.prompt, raw as Record<string, unknown>)
      return merged
    },
    write(config) {
      getHostContext().extensionSettings[CONFIG_KEY] = config
      const ctx = getHostContext()
      if (typeof ctx.saveSettingsDebounced === 'function') {
        ctx.saveSettingsDebounced()
      } else {
        pushLog('warn', 'config', 'saveSettingsDebounced 不可用，配置可能无法持久化')
      }
    },
    flush() {
      const ctx = getHostContext() as unknown as Record<string, unknown>
      if (typeof ctx.saveSettings === 'function') {
        (ctx as { saveSettings: () => void }).saveSettings()
      }
    },
    async listModels(preset) {
      if (!preset.baseURL) {
        return []
      }
      const headers = getRequestHeaders()
      headers['Content-Type'] = 'application/json'
      const res = await fetch('/api/backends/chat-completions/status', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          chat_completion_source: 'custom',
          custom_url: preset.baseURL,
          custom_include_headers: preset.apiKey
            ? `Authorization: Bearer ${preset.apiKey}`
            : '',
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: boolean; message?: string }
        throw new Error(err.message || `获取模型列表失败：${res.status}`)
      }
      const data = (await res.json()) as { data?: Array<{ id: string }> }
      return Array.isArray(data.data) ? data.data.map((m) => m.id) : []
    }
  }
}

function cloneDefault(): CranialNerveConfig {
  return {
    ...DEFAULT_CONFIG,
    aiPresets: [],
    vector: { ...DEFAULT_CONFIG.vector },
    prompt: clonePromptConfig(DEFAULT_CONFIG.prompt),
    tableFill: { ...DEFAULT_CONFIG.tableFill },
    tableTemplate: { presets: [], activeId: '', defaultId: '' }
  }
}

function clonePromptConfig(p: PromptConfig): PromptConfig {
  return {
    tableEdit: cloneScene(p.tableEdit),
    chronicleRecall: cloneScene(p.chronicleRecall),
    chronicleGenerate: cloneScene(p.chronicleGenerate)
  }
}

function cloneScene(s: ScenePromptConfig): ScenePromptConfig {
  return {
    presets: s.presets.map((p) => ({
      ...p,
      blocks: cloneBlocks(p.blocks)
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
    tableEdit: mergeScene(base.tableEdit, current.tableEdit),
    chronicleRecall: mergeScene(base.chronicleRecall, current.chronicleRecall),
    chronicleGenerate: mergeScene(base.chronicleGenerate, current.chronicleGenerate)
  }
  return migrateFromLegacy(raw, merged)
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
  const scenes: PromptSceneKey[] = ['tableEdit', 'chronicleRecall', 'chronicleGenerate']
  const result = clonePromptConfig(base)
  for (const key of scenes) {
    const segs = migrateField(templates[key])
    if (segs) {
      const block: PromptBlock = { id: newBlockId(), name: '主指令', segments: segs }
      const preset = presetFromBlocks([block])
      result[key] = { presets: [preset], activeId: preset.id, defaultId: preset.id }
    }
  }
  return result
}

function migrateField(val: unknown): PromptSegment[] | null {
  if (Array.isArray(val)) {
    return (val as PromptSegment[]).map((s) => ({ ...s }))
  }
  if (typeof val === 'string' && val.length > 0) {
    return [{ id: newId(), role: 'system', content: val }]
  }
  return null
}
