import {
  DEFAULT_CHRONICLE_GENERATE_PROMPT,
  DEFAULT_CHRONICLE_RECALL_PROMPT,
  DEFAULT_TABLE_EDIT_PROMPT
} from '@shared/prompts/defaults'
import type {
  AiPreset,
  CranialNerveConfig,
  PromptBlock,
  PromptSceneKey,
  PromptSegment,
  ScenePreset,
  ScenePromptConfig
} from '@shared/types/config'
import type { ChronicleEntry } from '@shared/types/worldbook'
import type { QueryResult } from '@shared/types/table'

function sceneFromBlocks(blocks: PromptBlock[]): ScenePromptConfig {
  const preset: ScenePreset = {
    id: 'default',
    name: '默认',
    blocks: blocks.map((b) => ({
      ...b,
      segments: b.segments.map((s) => ({ ...s }))
    }))
  }
  return { presets: [preset], activeId: preset.id, defaultId: preset.id }
}

let config: CranialNerveConfig = {
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
  prompt: {
    tableEdit: sceneFromBlocks(DEFAULT_TABLE_EDIT_PROMPT),
    chronicleRecall: sceneFromBlocks(DEFAULT_CHRONICLE_RECALL_PROMPT),
    chronicleGenerate: sceneFromBlocks(DEFAULT_CHRONICLE_GENERATE_PROMPT)
  },
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

const fakeTables: string[] = []

const fakeChronicles: ChronicleEntry[] = []

export function getSession() {
  return {
    getConfig(): CranialNerveConfig {
      return config
    },
    saveConfig(c: CranialNerveConfig): void {
      config = c
    },
    async listModels(_preset: AiPreset): Promise<string[]> {
      return []
    },
    getActiveAiPreset(): AiPreset | null {
      return config.aiPresets.find((p) => p.id === config.activeAiPresetId) ?? null
    },
    getActivePromptPreset(): ScenePreset | null {
      const scene = config.prompt.tableEdit
      return scene.presets.find((p) => p.id === scene.activeId) ?? scene.presets[0] ?? null
    },
    getActiveSegments(scene: PromptSceneKey): PromptSegment[] {
      const sc = config.prompt[scene]
      const preset = sc.presets.find((p) => p.id === sc.activeId) ?? sc.presets[0]
      return preset?.blocks.flatMap((b) => b.segments) ?? []
    },
    listTables(): string[] {
      return fakeTables
    },
    getTableData(_name: string): QueryResult[] {
      return [{ columns: [], rows: [] }]
    },
    getTableRowsWithRowid(_name: string): QueryResult[] {
      return [{ columns: [], rows: [] }]
    },
    updateCell(): void {},
    deleteRow(): void {},
    insertRow(): void {},
    getTemplate() {
      const tt = config.tableTemplate
      const active = tt.presets.find((p) => p.id === tt.activeId)
      return active?.template ?? null
    },
    getTableDef(name: string) {
      const defs: Record<string, { name: string; displayName: string; columns: unknown[] }> = {
        inventory: { name: 'inventory', displayName: '背包物品表', columns: [] },
        npc_info: { name: 'npc_info', displayName: 'NPC 信息表', columns: [] },
        quest_log: { name: 'quest_log', displayName: '任务记录表', columns: [] }
      }
      return defs[name] ?? null
    },
    getChronicleStore() {
      return {
        async list(): Promise<ChronicleEntry[]> {
          return fakeChronicles
        },
        async removeByKey(): Promise<boolean> {
          return false
        }
      }
    },
    getChatToken(): string {
      return 'dev_mock_token'
    },
    worldbook: {
      getCurrentCharLorebookName(): string | null {
        return null
      },
      async loadLorebook(): Promise<never> {
        throw new Error('not implemented')
      },
      async saveLorebook(): Promise<void> {
        return
      },
      async createWorldbook(): Promise<void> {
        return
      },
      async deleteWorldbook(): Promise<void> {
        return
      },
      listWorldbookNames(): string[] {
        return []
      },
      async attachToChat(): Promise<void> {
        return
      },
      async detachFromChat(): Promise<void> {
        return
      }
    }
  }
}
