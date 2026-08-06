import { describe, expect, it, vi, beforeEach } from 'vitest'
import { onMessageSentForFill, resetFillScheduler } from '../src/core/table/fill-orchestrator'
import type { CranialNerveSession } from '../src/core/session'
import type { CranialNerveConfig } from '../src/shared/types/config'

function makeConfig(): CranialNerveConfig {
  return {
    aiPresets: [],
    activeAiPresetId: '',
    vector: { embeddingEndpoint: '', embeddingApiKey: '', embeddingModel: '', rerankEndpoint: '', rerankApiKey: '', rerankModel: '' },
    vectorEnabled: false,
    snapshotStrategy: 'every-message',
    prompt: { tableEdit: { presets: [], activeId: '', defaultId: '' }, chronicleGen: { presets: [], activeId: '', defaultId: '' }, chronicleRecall: { presets: [], activeId: '', defaultId: '' } },
    tableFill: {
      autoFillTrigger: 'after-send',
      regenerateFill: true,
      contextDepth: 3,
      updateFrequency: 1,
      batchSize: 3,
      skipFloors: 0,
      maxRetries: 3,
      manualUpdateContextDepth: null,
      manualUpdateBatchSize: null,
      manualSelectedTables: [],
      hasManualSelection: false,
      manualIncludeChronicle: false,
    },
    chronicleFill: {
      autoFillTrigger: 'off',
      regenerateFill: true,
      contextDepth: 3,
      updateFrequency: 1,
      batchSize: 3,
      skipFloors: 0,
      maxRetries: 3,
      chronicleSendLatestRows: 10,
      manualUpdateContextDepth: null,
      manualUpdateBatchSize: null,
      manualIncludeTables: false,
    },
    maxRecallItems: 25,
    recallEnabled: true,
    recallRecentFixedInjectCount: 5,
    recallMinScore: 0.45,
    tableFillPresetId: 'p1',
    chronicleGenPresetId: '',
    recallPresetId: '',
    recallContextDepth: 5,
    retainFloors: 100,
    pending: { aiCallTimeoutMs: 60000, aiTimeoutRetries: 1, listModelsTimeoutMs: 10000, writeQueueDrainTimeoutMs: 8000, summarizeOnManualAbort: false, minSummaryLength: 0 },
    tableTemplate: { presets: [], activeId: '', defaultId: '' },
  }
}

function makeMockSession(chat: unknown[]) {
  const getAiPresetForScene = vi.fn(() => null)
  const session = {
    getConfig: () => makeConfig(),
    chat: { getChat: () => chat },
    getAiPresetForScene,
  } as unknown as CranialNerveSession
  return { session, getAiPresetForScene }
}

describe('onMessageSentForFill（after-send 填上一轮）', () => {
  beforeEach(() => {
    resetFillScheduler()
  })

  it('有上一轮 AI 时触发 executeFill', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi' },
      { is_user: false, is_system: false, mes: 'ai reply' },
      { is_user: true, is_system: false, mes: 'new msg' },
    ]
    const { session, getAiPresetForScene } = makeMockSession(chat)
    await onMessageSentForFill(session, 2)
    expect(getAiPresetForScene).toHaveBeenCalled()
  })

  it('无上一轮 AI（首轮）跳过', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi' },
    ]
    const { session, getAiPresetForScene } = makeMockSession(chat)
    await onMessageSentForFill(session, 0)
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('system 消息不当作上一轮 AI，继续往前找', async () => {
    const chat = [
      { is_user: false, is_system: false, mes: 'ai reply' },
      { is_user: false, is_system: true, mes: 'system note' },
      { is_user: true, is_system: false, mes: 'new msg' },
    ]
    const { session, getAiPresetForScene } = makeMockSession(chat)
    await onMessageSentForFill(session, 2)
    expect(getAiPresetForScene).toHaveBeenCalled()
  })

  it('userMsgId 前全是 system/user 无 AI 时跳过', async () => {
    const chat = [
      { is_user: false, is_system: true, mes: 'system note' },
      { is_user: true, is_system: false, mes: 'msg' },
      { is_user: false, is_system: true, mes: 'system2' },
      { is_user: true, is_system: false, mes: 'new msg' },
    ]
    const { session, getAiPresetForScene } = makeMockSession(chat)
    await onMessageSentForFill(session, 3)
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('长对话时 after-send 按 contextDepth 截取上一轮附近消息（与 after-ai 一致）', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'u0' },
      { is_user: false, is_system: false, mes: 'a1' },
      { is_user: true, is_system: false, mes: 'u2' },
      { is_user: false, is_system: false, mes: 'a3' },
      { is_user: true, is_system: false, mes: 'u4' },
      { is_user: false, is_system: false, mes: 'a5' },
      { is_user: true, is_system: false, mes: 'new msg' },
    ]
    const { session, getAiPresetForScene } = makeMockSession(chat)
    await onMessageSentForFill(session, 6)
    expect(getAiPresetForScene).toHaveBeenCalled()
  })
})
