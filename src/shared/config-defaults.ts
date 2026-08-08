import type { CranialNerveConfig } from '@shared/types/config'

export function applyDefaults(c: CranialNerveConfig): void {
  c.tableFill.autoFillTrigger = 'after-ai'
  c.tableFill.regenerateFill = true
  c.tableFill.contextDepth = 3
  c.tableFill.updateFrequency = 1
  c.tableFill.batchSize = 10
  c.tableFill.skipFloors = 0
  c.tableFill.maxRetries = 3
  c.tableFill.manualUpdateContextDepth = null
  c.tableFill.manualUpdateBatchSize = null
  c.tableFill.manualSelectedTables = []
  c.tableFill.manualIncludeChronicle = false
  c.chronicleFill.autoFillTrigger = 'after-ai'
  c.chronicleFill.regenerateFill = true
  c.chronicleFill.contextDepth = 3
  c.chronicleFill.updateFrequency = 1
  c.chronicleFill.batchSize = 10
  c.chronicleFill.skipFloors = 0
  c.chronicleFill.maxRetries = 3
  c.chronicleFill.chronicleSendLatestRows = 10
  c.chronicleFill.manualUpdateContextDepth = null
  c.chronicleFill.manualUpdateBatchSize = null
  c.recallEnabled = true
  c.maxRecallItems = 25
  c.recallContextDepth = 5
  c.recallRecentFixedInjectCount = 5
  c.recallMinScore = 0.45
  c.recallFadeMinDepth = 2
  c.snapshotStrategy = 'every-message'
  c.retainFloors = 100
  c.checkpointInterval = 20
  c.pending.aiCallTimeoutMs = 0
  c.pending.aiTimeoutRetries = 1
  c.pending.listModelsTimeoutMs = 10000
  c.pending.writeQueueDrainTimeoutMs = 8000
  c.pending.summarizeOnManualAbort = false
  c.pending.minSummaryLength = 100
  c.vector = { embeddingEndpoint: '', embeddingApiKey: '', embeddingModel: '', rerankEndpoint: '', rerankApiKey: '', rerankModel: '' }
  c.vectorEnabled = false
}
