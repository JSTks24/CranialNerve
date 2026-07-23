import type { CardTemplate } from './card'

export interface AiPreset {
  id: string
  name: string
  baseURL: string
  apiKey: string
  model: string
  maxTokens: number
  temperature: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
  seed: number
  stream: boolean
  customIncludeBody: string
  customExcludeBody: string
  customIncludeHeaders: string
}

export interface VectorConfig {
  embeddingEndpoint: string
  embeddingApiKey: string
  embeddingModel: string
  rerankEndpoint: string
  rerankApiKey: string
  rerankModel: string
}

export type SnapshotStrategy = 'every-message' | 'latest-only'

export type PromptRole = 'system' | 'user' | 'assistant'

export interface PromptSegment {
  id: string
  role: PromptRole
  content: string
}

export interface PromptBlock {
  id: string
  name: string
  segments: PromptSegment[]
}

export type PromptSceneKey = 'tableEdit' | 'chronicleRecall' | 'chronicleGenerate'

export interface ScenePreset {
  id: string
  name: string
  blocks: PromptBlock[]
}

export interface ScenePromptConfig {
  presets: ScenePreset[]
  activeId: string
  defaultId: string
}

export interface PromptConfig {
  tableEdit: ScenePromptConfig
  chronicleRecall: ScenePromptConfig
  chronicleGenerate: ScenePromptConfig
}

export interface TableTemplatePreset {
  id: string
  name: string
  template: CardTemplate
  source: 'card' | 'user'
}

export interface TableTemplateConfig {
  presets: TableTemplatePreset[]
  activeId: string
  defaultId: string
}

export interface TableFillConfig {
  autoFill: boolean
  contextDepth: number
  updateFrequency: number
  batchSize: number
  skipFloors: number
  groupId: number
  maxRetries: number
}

export interface CranialNerveConfig {
  aiPresets: AiPreset[]
  activeAiPresetId: string
  vector: VectorConfig
  vectorEnabled: boolean
  maxRetries: number
  snapshotStrategy: SnapshotStrategy
  prompt: PromptConfig
  tableFill: TableFillConfig
  maxRecallItems: number
  recallEnabled: boolean
  chronicleGenEnabled: boolean
  tableFillPresetId: string
  recallPresetId: string
  chronicleGenPresetId: string
  recallContextDepth: number
  retainFloors: number
  tableTemplate: TableTemplateConfig
}
