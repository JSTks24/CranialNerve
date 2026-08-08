import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  onGenerationEnded,
  snapshotLastAiLength,
  resetFillScheduler,
  resetGenerationStopped,
  markGenerationStopped,
} from '../src/core/table/fill-orchestrator'
import type { CranialNerveSession } from '../src/core/session'
import type { CranialNerveConfig, AutoFillTrigger } from '../src/shared/types/config'

interface MockSessionOpts {
  trigger: AutoFillTrigger
  chronicleTrigger?: AutoFillTrigger
  frequency: number
  chronicleFrequency?: number
  startAiMes: string
  minSummaryLength?: number
  summarizeOnManualAbort?: boolean
  tableRegenerateFill?: boolean
  chronicleRegenerateFill?: boolean
  template?: { tables: { name: string; enabled?: boolean }[] }
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
    snapshotStrategy: 'every-message',
    prompt: {
      tableEdit: { presets: [], activeId: '', defaultId: '' },
      chronicleGen: { presets: [], activeId: '', defaultId: '' },
      chronicleRecall: { presets: [], activeId: '', defaultId: '' },
    },
    tableFill: {
      autoFillTrigger: opts.trigger,
      regenerateFill: opts.tableRegenerateFill ?? true,
      contextDepth: 3,
      updateFrequency: opts.frequency,
      batchSize: 3,
      skipFloors: 0,
      maxRetries: 3,
      manualUpdateContextDepth: null,
      manualUpdateBatchSize: null,
      manualSelectedTables: [],

      manualIncludeChronicle: false,
    },
    chronicleFill: {
      autoFillTrigger: opts.chronicleTrigger ?? 'off',
      regenerateFill: opts.chronicleRegenerateFill ?? true,
      contextDepth: 3,
      updateFrequency: opts.chronicleFrequency ?? 1,
      batchSize: 3,
      skipFloors: 0,
      maxRetries: 3,
      chronicleSendLatestRows: 10,
      manualUpdateContextDepth: null,
      manualUpdateBatchSize: null,

    },
    maxRecallItems: 25,
    recallEnabled: true,
    recallRecentFixedInjectCount: 5,
    recallMinScore: 0.45,
    recallFadeMinDepth: 2,
    tableFillPresetId: 'p1',
    chronicleGenPresetId: 'cp',
    recallPresetId: '',
    recallContextDepth: 5,
    retainFloors: 100,
    checkpointInterval: 20,
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
    getTemplate: opts.template ? () => opts.template : () => null,
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
      trigger: 'after-ai',
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
      trigger: 'after-ai',
      frequency: 2,
      startAiMes: 'old',
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session, { force: true })
    expect(getAiPresetForScene).toHaveBeenCalled()
  })

  it('force=true 但 trigger=off 仍跳过', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      trigger: 'off',
      frequency: 2,
      startAiMes: 'old',
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session, { force: true })
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('force=true 时即使 AI 长度相同（regenerate 同长回复）仍触发 executeFill', async () => {
    const { session, getAiPresetForScene } = makeMockSession({
      trigger: 'after-ai',
      frequency: 2,
      startAiMes: 'same',
    })
    snapshotLastAiLength(session)
    await onGenerationEnded(session, { force: true })
    expect(getAiPresetForScene).toHaveBeenCalled()
  })

  it('force=false 且 AI 输出无新增（长度相同）时跳过', async () => {
    const { session, getAiPresetForScene } = makeMockSession({
      trigger: 'after-ai',
      frequency: 1,
      startAiMes: 'same',
    })
    snapshotLastAiLength(session)
    await onGenerationEnded(session)
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('force=true 但 minSummaryLength 不足仍跳过', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      trigger: 'after-ai',
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
      trigger: 'after-ai',
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
      trigger: 'after-ai',
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
      trigger: 'after-ai',
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

  it('after-send 普通生成跳过（等 message_sent 填上一轮）', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      trigger: 'after-send',
      frequency: 1,
      startAiMes: 'old',
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session)
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('after-send + force 仍跳过（regenerate 不在 generation_ended 填）', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      trigger: 'after-send',
      frequency: 1,
      startAiMes: 'old',
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session, { force: true })
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('force 时仅 chronicle 开 regenerateFill，只走 chronicle 不误带 table', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      trigger: 'after-ai',
      chronicleTrigger: 'after-ai',
      frequency: 2,
      chronicleFrequency: 2,
      tableRegenerateFill: false,
      chronicleRegenerateFill: true,
      startAiMes: 'old',
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session, { force: true })
    expect(getAiPresetForScene).toHaveBeenCalledWith('cp')
  })

  it('force 时仅 table 开 regenerateFill，只走 table 不误带 chronicle', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      trigger: 'after-ai',
      chronicleTrigger: 'after-ai',
      frequency: 2,
      chronicleFrequency: 2,
      tableRegenerateFill: true,
      chronicleRegenerateFill: false,
      startAiMes: 'old',
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session, { force: true })
    expect(getAiPresetForScene).toHaveBeenCalledWith('p1')
  })

  it('merged 就绪但模板表全禁用时退化为只生成纪要', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      trigger: 'after-ai',
      chronicleTrigger: 'after-ai',
      frequency: 1,
      chronicleFrequency: 1,
      startAiMes: 'old',
      template: { tables: [{ name: 't', enabled: false }] },
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session)
    expect(getAiPresetForScene).toHaveBeenCalledWith('cp')
  })

  it('模板存在且表启用时 merged 正常走 table 预设', async () => {
    const { session, getAiPresetForScene, setAiMes } = makeMockSession({
      trigger: 'after-ai',
      chronicleTrigger: 'after-ai',
      frequency: 1,
      chronicleFrequency: 1,
      startAiMes: 'old',
      template: { tables: [{ name: 't', enabled: true }] },
    })
    snapshotLastAiLength(session)
    setAiMes('new content')
    await onGenerationEnded(session)
    expect(getAiPresetForScene).toHaveBeenCalledWith('p1')
  })
})
