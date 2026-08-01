import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  onGenerationEnded,
  snapshotLastAiLength,
  resetFillScheduler,
  resetGenerationStopped,
  markGenerationStopped,
} from '../src/core/table/fill-orchestrator'
import type { CranialNerveSession } from '../src/core/session'
import type { CranialNerveConfig } from '../src/shared/types/config'

interface MockSessionOpts {
  autoFill: boolean
  frequency: number
  startAiMes: string
  minSummaryLength?: number
  summarizeOnManualAbort?: boolean
}

function makeConfig(opts: MockSessionOpts): CranialNerveConfig {
  return {
    aiPresets: [],
    activeAiPresetId: '',
    vector: {
      embeddingEndpoint: '',
      embeddingApiKey: '',
      embeddingModel: '',
      rerankEndpoint: '',
      rerankApiKey: '',
      rerankModel: '',
    },
    vectorEnabled: false,
    maxRetries: 3,
    snapshotStrategy: 'every-message',
    prompt: {
      tableEdit: { presets: [], activeId: '', defaultId: '' },
      chronicleRecall: { presets: [], activeId: '', defaultId: '' },
    },
    tableFill: {
      autoFill: opts.autoFill,
      contextDepth: 3,
      updateFrequency: opts.frequency,
      batchSize: 3,
      skipFloors: 0,
      maxRetries: 3,
      manualUpdateContextDepth: null,
      manualUpdateBatchSize: null,
      manualSelectedTables: [],
      hasManualSelection: false,
    },
    maxRecallItems: 25,
    recallEnabled: true,
    chronicleGenEnabled: true,
    tableFillPresetId: 'p1',
    recallPresetId: '',
    recallContextDepth: 5,
    retainFloors: 100,
    pending: {
      aiCallTimeoutMs: 60000,
      aiTimeoutRetries: 1,
      listModelsTimeoutMs: 10000,
      writeQueueDrainTimeoutMs: 8000,
      summarizeOnManualAbort: opts.summarizeOnManualAbort ?? false,
      minSummaryLength: opts.minSummaryLength ?? 0,
    },
    tableTemplate: { presets: [], activeId: '', defaultId: '' },
  }
}

function makeMockSession(opts: MockSessionOpts) {
  const chat = [{ is_user: false, is_system: false, mes: opts.startAiMes }]
  const getAiPresetForScene = vi.fn(() => null)
  const session = {
    getConfig: () => makeConfig(opts),
    chat: { getChat: () => chat },
    getAiPresetForScene,
  } as unknown as CranialNerveSession
  const setAiMes = (mes: string) => {
    ;(chat[0] as { mes: string }).mes = mes
  }
  return { session, getAiPresetForScene, setAiMes }
}

describe('onGenerationEnded force 参数', () => {
  beforeEach(() => {
    resetFillScheduler()
    resetGenerationStopped()
  })

  it('force=false 且 frequency 未达时不触发 executeFill', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      autoFill: true,
      frequency: 2,
      startAiMes: 'old',
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session)
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('force=true 跳过 frequency 触发 executeFill', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      autoFill: true,
      frequency: 2,
      startAiMes: 'old',
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session, { force: true })
    expect(getAiPresetForScene).toHaveBeenCalled()
  })

  it('force=true 但 autoFill 关闭仍跳过', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      autoFill: false,
      frequency: 2,
      startAiMes: 'old',
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session, { force: true })
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('force=true 但 AI 无新增仍跳过', async () => {
    const { session, getAiPresetForScene } = makeMockSession({
      autoFill: true,
      frequency: 2,
      startAiMes: 'same',
    })
    snapshotLastAiLength(session)
    await onGenerationEnded(session, { force: true })
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('force=true 但 minSummaryLength 不足仍跳过', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      autoFill: true,
      frequency: 2,
      startAiMes: 'old',
      minSummaryLength: 1000,
    })
    snapshotLastAiLength(session)
    setAiMes('short')
    await onGenerationEnded(session, { force: true })
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('force=false frequency=1 正常触发 executeFill', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      autoFill: true,
      frequency: 1,
      startAiMes: 'old',
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session)
    expect(getAiPresetForScene).toHaveBeenCalled()
  })

  it('手动中止且 summarizeOnManualAbort=false 时跳过 executeFill', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      autoFill: true,
      frequency: 1,
      startAiMes: 'old',
      summarizeOnManualAbort: false,
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    markGenerationStopped()
    await onGenerationEnded(session)
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('手动中止且 summarizeOnManualAbort=true 时仍触发 executeFill', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      autoFill: true,
      frequency: 1,
      startAiMes: 'old',
      summarizeOnManualAbort: true,
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    markGenerationStopped()
    await onGenerationEnded(session)
    expect(getAiPresetForScene).toHaveBeenCalled()
  })
})
