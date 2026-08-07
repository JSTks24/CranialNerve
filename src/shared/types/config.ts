import type { CardTemplate } from './card'
import type { TableDef } from './table'

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
  seed: number | null
  stream: boolean
  responseFormat: 'none' | 'json_object'
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

export type SnapshotStrategy = 'every-message' | 'latest-only' | 'retain-recent'

export type PromptRole = 'system' | 'user' | 'assistant'

export interface PromptSegment {
  id: string
  name: string
  role: PromptRole
  content: string
}

export type PromptSceneKey = 'tableEdit' | 'chronicleGen' | 'chronicleRecall'

export interface ScenePreset {
  id: string
  name: string
  segments: PromptSegment[]
}

export interface ScenePromptConfig {
  presets: ScenePreset[]
  activeId: string
  defaultId: string
}

export interface PromptConfig {
  tableEdit: ScenePromptConfig
  chronicleGen: ScenePromptConfig
  chronicleRecall: ScenePromptConfig
}

export interface TableTemplatePreset {
  id: string
  name: string
  template: CardTemplate
  source: 'card' | 'user' | 'builtin'
}

export interface TableTemplateConfig {
  presets: TableTemplatePreset[]
  activeId: string
  defaultId: string
}

export type AutoFillTrigger = 'off' | 'after-ai' | 'after-send'

export interface TableFillConfig {
  autoFillTrigger: AutoFillTrigger
  regenerateFill: boolean
  contextDepth: number
  updateFrequency: number
  batchSize: number
  skipFloors: number
  maxRetries: number
  manualUpdateContextDepth: number | null
  manualUpdateBatchSize: number | null
  manualSelectedTables: string[]
  manualIncludeChronicle: boolean
}

export interface ChronicleFillConfig {
  autoFillTrigger: AutoFillTrigger
  regenerateFill: boolean
  contextDepth: number
  updateFrequency: number
  batchSize: number
  skipFloors: number
  maxRetries: number
  chronicleSendLatestRows: number
  manualUpdateContextDepth: number | null
  manualUpdateBatchSize: number | null
}

export interface PendingConfig {
  aiCallTimeoutMs: number
  aiTimeoutRetries: number
  listModelsTimeoutMs: number
  writeQueueDrainTimeoutMs: number
  summarizeOnManualAbort: boolean
  minSummaryLength: number
}

export interface CranialNerveConfig {
  aiPresets: AiPreset[]
  activeAiPresetId: string
  vector: VectorConfig
  vectorEnabled: boolean
  snapshotStrategy: SnapshotStrategy
  prompt: PromptConfig
  tableFill: TableFillConfig
  chronicleFill: ChronicleFillConfig
  maxRecallItems: number
  recallEnabled: boolean
  recallRecentFixedInjectCount: number
  recallMinScore: number
  tableFillPresetId: string
  chronicleGenPresetId: string
  recallPresetId: string
  recallContextDepth: number
  retainFloors: number
  checkpointInterval: number
  tableTemplate: TableTemplateConfig
  pending: PendingConfig
  chronicleTableHints?: ChronicleTableHints
  chronicleTableDef?: TableDef
}

export interface ChronicleTableHints {
  note?: string
  insertHint?: string
  updateHint?: string
  deleteHint?: string
}

export interface ProgressNotifier {
  done(): void
  fail(errText: string): void
  close(): void
  update?(text: string): void
  abortSignal: AbortSignal
}

export type ProgressStarter = (text: string) => ProgressNotifier

export interface ToastNotifier {
  success(text: string): void
  warning(text: string): void
  error(text: string): void
  info(text: string): void
}
