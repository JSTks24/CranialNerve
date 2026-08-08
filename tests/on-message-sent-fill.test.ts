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

    },
    maxRecallItems: 25,
    recallEnabled: true,
    recallRecentFixedInjectCount: 5,
    recallMinScore: 0.45,
    recallFadeMinDepth: 2,
    tableFillPresetId: 'p1',
    chronicleGenPresetId: '',
    recallPresetId: '',
    recallContextDepth: 5,
    retainFloors: 100,
    checkpointInterval: 20,
    pending: { aiCallTimeoutMs: 60000, aiTimeoutRetries: 1, listModelsTimeoutMs: 10000, writeQueueDrainTimeoutMs: 8000, summarizeOnManualAbort: false, minSummaryLength: 0 },
    tableTemplate: { presets: [], activeId: '', defaultId: '' },
  }
}

function makeMockSession(chat: unknown[], meta: Record<string, unknown> = {}) {
  const getAiPresetForScene = vi.fn(() => null)
  const session = {
    getConfig: () => makeConfig(),
    chat: {
      getChat: () => chat,
      readChatMetadata: (k: string) => meta[k],
    },
    getAiPresetForScene,
    getSyncBridgeRepo: () => null,
    getTaskAbortSignal: () => undefined,
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
      { is_user: true, is_system: false, mes: 'hi' },
      { is_user: false, is_system: true, mes: 'system note' },
      { is_user: false, is_system: false, mes: 'ai reply' },
      { is_user: true, is_system: false, mes: 'new msg' },
    ]
    const { session, getAiPresetForScene } = makeMockSession(chat)
    await onMessageSentForFill(session, 3)
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

describe('onMessageSentForFill after-send 幂等（3.7 修复：跳过已填楼层）', () => {
  beforeEach(() => {
    resetFillScheduler()
  })

  it('上一轮已填（FILL_PROGRESS 覆盖）时跳过不重填', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi' },
      { is_user: false, is_system: false, mes: 'ai reply' },
      { is_user: true, is_system: false, mes: 'new msg' },
    ]
    const { session, getAiPresetForScene } = makeMockSession(chat, { CN_FILL_PROGRESS: { tableFloor: 1 } })
    await onMessageSentForFill(session, 2)
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('有未填楼层时触发填表', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi' },
      { is_user: false, is_system: false, mes: 'ai reply' },
      { is_user: true, is_system: false, mes: 'new msg' },
    ]
    const { session, getAiPresetForScene } = makeMockSession(chat, { CN_FILL_PROGRESS: { tableFloor: 0 } })
    await onMessageSentForFill(session, 2)
    expect(getAiPresetForScene).toHaveBeenCalled()
  })

  it('已填楼层较早时只填未填楼层（lastAiId 覆盖但 baseLast 之后的 AI 楼触发）', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'u0' },
      { is_user: false, is_system: false, mes: 'a1' },
      { is_user: true, is_system: false, mes: 'u2' },
      { is_user: false, is_system: false, mes: 'a3' },
      { is_user: true, is_system: false, mes: 'new msg' },
    ]
    const { session, getAiPresetForScene } = makeMockSession(chat, { CN_FILL_PROGRESS: { tableFloor: 1 } })
    await onMessageSentForFill(session, 4)
    expect(getAiPresetForScene).toHaveBeenCalled()
  })
})

describe('onMessageSentForFill merged（双 after-send，一侧游标 null 不塌缩）', () => {
  beforeEach(() => {
    resetFillScheduler()
  })

  function makeMergedSession(chat: unknown[], meta: Record<string, unknown> = {}) {
    const cfg = makeConfig()
    cfg.tableFill.autoFillTrigger = 'after-send'
    cfg.chronicleFill.autoFillTrigger = 'after-send'
    const getAiPresetForScene = vi.fn(() => null)
    const session = {
      getConfig: () => cfg,
      chat: {
        getChat: () => chat,
        readChatMetadata: (k: string) => meta[k],
      },
      getAiPresetForScene,
      getSyncBridgeRepo: () => null,
      getTaskAbortSignal: () => undefined,
      getTemplate: () => ({ tables: [{ name: 't', displayName: 't', columns: [{ name: 'c', displayName: 'c', type: 'TEXT' }], enabled: true }] }),
    } as unknown as CranialNerveSession
    return { session, getAiPresetForScene }
  }

  it('tableFloor 已到顶但 chronicleFloor 缺失时不塌缩全量重填（跳过本轮）', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi' },
      { is_user: false, is_system: false, mes: 'ai reply' },
      { is_user: true, is_system: false, mes: 'new msg' },
    ]
    const { session, getAiPresetForScene } = makeMergedSession(chat, { CN_FILL_PROGRESS: { tableFloor: 1 } })
    await onMessageSentForFill(session, 2)
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('两侧游标均缺失时仍走 merged 填上一轮', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi' },
      { is_user: false, is_system: false, mes: 'ai reply' },
      { is_user: true, is_system: false, mes: 'new msg' },
    ]
    const { session, getAiPresetForScene } = makeMergedSession(chat)
    await onMessageSentForFill(session, 2)
    expect(getAiPresetForScene).toHaveBeenCalled()
  })
})
