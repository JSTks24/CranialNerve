import { describe, expect, it, vi } from 'vitest'
import { runManualFill, detectLastSummarizedAiFloor, detectLastUpdatedAiFloorForTable, detectActualUpdateFloorForTable, rollbackFillProgress, subscribeFillState } from '../src/core/table/fill-orchestrator'
import { createPersistContext, persistFill } from '../src/db/sqlite/frame-persist'
import SqliteCore from '../src/db/sqlite/core'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
import createFrameRepo from '../src/db/sqlite/storage-frame-repo'
import { FRAME_FIELD_PREFIX } from '../src/shared/constants/msg-fields'
import type { ChatGateway } from '../src/db/gateways/chat'
import type { StorageFrame, SqlBatchOperation } from '../src/shared/types/storage-frame'
import type { CranialNerveSession } from '../src/core/session'

vi.mock('@db/gateways/host-context', () => ({
  getHostContext: () => ({ characters: {}, characterId: 0, chatId: 'test' }),
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
}))
vi.mock('@db/gateways/host-state', () => ({
  getPersonaDescription: () => '',
  getCharDescription: () => '',
  getUserName: () => 'User',
}))

const FILL_PROGRESS_KEY = 'CN_FILL_PROGRESS'

type FrameReason = SqlBatchOperation['reason'] | SqlBatchOperation['reason'][]

function makeFrame(reason: FrameReason, statements: string[] = ['INSERT INTO t VALUES (1)']): StorageFrame {
  const reasons = Array.isArray(reason) ? reason : [reason]
  return {
    version: 2,
    logEntries: [{ seq: 1, createdAt: 0, operations: reasons.map((r) => ({ kind: 'sql_batch', statements, reason: r })) }],
    checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: { tables: [] } },
  }
}

function makeSession(chat: FakeMessage[], frames: Record<number, FrameReason>): CranialNerveSession {
  for (const [idStr, reason] of Object.entries(frames) as Array<[string, FrameReason]>) {
    const id = Number(idStr)
    ;(chat[id] as FakeMessage).extra = { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame(reason)) }
  }
  const metadata: Record<string, unknown> = {}
  const gateway = {
    getChat: () => chat,
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      const m = chat[id]
      if (!m) return
      if (!m.extra) m.extra = {}
      m.extra[key] = value
    },
    readChatMetadata: (key: string) => metadata[key],
    writeChatMetadata: (key: string, value: unknown) => {
      metadata[key] = value
    },
  } as unknown as ChatGateway
  return {
    getSyncBridgeRepo: () => createFrameRepo(gateway),
    chat: {
      getChat: () => chat,
      readChatMetadata: (key: string) => metadata[key],
      writeChatMetadata: (key: string, value: unknown) => {
        metadata[key] = value
      },
    },
  } as unknown as CranialNerveSession
}

interface FakeMessage {
  is_user: boolean
  is_system: boolean
  mes: string
  extra: Record<string, unknown>
}

function makePreset(maxTokens = 100) {
  return { id: 'p1', name: 'p', baseURL: 'http://x', apiKey: 'k', model: 'm', maxTokens, temperature: 0, topP: 1, frequencyPenalty: 0, presencePenalty: 0, seed: null, stream: false, responseFormat: 'none' as const, customIncludeBody: '', customExcludeBody: '', customIncludeHeaders: '' }
}

function makeRunSession(core: SqliteCore, chat: FakeMessage[] | (() => FakeMessage[]), frames: Record<number, FrameReason>, editorRun: (ctx: { segments: { content: string }[] }, options?: { expectedSqlObjects?: number }) => Promise<any>): { session: CranialNerveSession, meta: Record<string, unknown> } {
  const resolveChat = () => (typeof chat === 'function' ? (chat as () => FakeMessage[])() : chat as FakeMessage[])
  if (typeof chat !== 'function') {
    for (const [idStr, reason] of Object.entries(frames) as Array<[string, FrameReason]>) {
      const id = Number(idStr)
      ;(chat[id] as FakeMessage).extra = { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame(reason)) }
    }
  }
  const meta: Record<string, unknown> = {}
  const gateway = {
    getChat: resolveChat,
    readMessageExtra: (id: number, key: string) => resolveChat()[id]?.extra?.[key],
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      const m = resolveChat()[id]; if (!m) return; if (!m.extra) m.extra = {}; m.extra[key] = value
    },
    saveChat: async () => {},
  } as unknown as ChatGateway
  const syncBridge = new SqliteSyncBridge(core, gateway)
  const session = {
    core,
    getConfig: () => ({
      aiPresets: [], activeAiPresetId: '', vector: { embeddingEndpoint: '', embeddingApiKey: '', embeddingModel: '', rerankEndpoint: '', rerankApiKey: '', rerankModel: '' },
      vectorEnabled: false, snapshotStrategy: 'every-message',
      prompt: { tableEdit: { presets: [], activeId: '', defaultId: '' }, chronicleGen: { presets: [], activeId: '', defaultId: '' }, chronicleRecall: { presets: [], activeId: '', defaultId: '' } },
      tableFill: { autoFillTrigger: 'off', regenerateFill: false, contextDepth: 3, updateFrequency: 1, batchSize: 3, skipFloors: 0, maxRetries: 3, manualUpdateContextDepth: null, manualUpdateBatchSize: null, manualSelectedTables: [], manualIncludeChronicle: false },
      chronicleFill: { autoFillTrigger: 'off', regenerateFill: false, contextDepth: 3, updateFrequency: 1, batchSize: 3, skipFloors: 0, maxRetries: 3, chronicleSendLatestRows: 10, manualUpdateContextDepth: null, manualUpdateBatchSize: null },
      maxRecallItems: 25, recallEnabled: true, recallRecentFixedInjectCount: 5, recallMinScore: 0.45, tableFillPresetId: 'p1', chronicleGenPresetId: 'p2',
      recallPresetId: '', recallContextDepth: 5, retainFloors: 100, checkpointInterval: 20,
      pending: { aiCallTimeoutMs: 60000, aiTimeoutRetries: 1, listModelsTimeoutMs: 10000, writeQueueDrainTimeoutMs: 8000, summarizeOnManualAbort: false, minSummaryLength: 0 },
      tableTemplate: { presets: [], activeId: '', defaultId: '' },
      chronicleTableDef: { name: 'cn_chronicle', displayName: '纪要表', columns: [{ name: 'key', displayName: '编码', type: 'TEXT' }] },
    }),
    getAiPresetForScene: () => makePreset(),
    getTemplate: () => ({ tables: [{ name: 't', displayName: 't', columns: [{ name: 'c', displayName: 'c', type: 'TEXT' }], enabled: true }] }),
    chat: { getChat: resolveChat, readChatMetadata: (key: string) => meta[key], writeChatMetadata: (key: string, value: unknown) => { meta[key] = value } },
    getActiveSegments: () => [{ id: 's1', name: '正文', role: 'user' as const, content: '正文: {{conversation}}' }],
    worldbook: { getCurrentCharLorebookName: () => null, loadLorebook: async () => ({ entries: {} }) },
    getTableEditor: () => ({ run: editorRun }),
    getSyncBridgeRepo: () => syncBridge.getRepo(),
    applySnapshot: () => {},
    getProgressNotifier: () => undefined,
    getTaskAbortSignal: () => undefined,
    getWriteQueue: () => ({ enqueue: (fn: () => Promise<any>) => fn() }),
    getCurrentTemplateId: () => null,
    cleanupOldSnapshots: () => {},
    persistAfterFill: (messageId: number, ops: import('../src/shared/types/storage-frame').MutationOperation[]) => {
      const ctx = createPersistContext(syncBridge.getRepo(), core)
      persistFill(ctx, messageId, ops, { strategy: 'every-message', retainFloors: 100 })
    },
    ensureBoundTemplate: () => {},
    finishFillBucket: () => {},
    getChatToken: () => 'test',
  } as unknown as CranialNerveSession
  return { session, meta }
}

describe('per-table 游标：空更新也算一次决策', () => {
  it('AI 返回空 SQL（决策无需变更）时，全部目标表的处理楼层推进到桶末楼', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
    ]
    const { session, meta } = makeRunSession(core, chat, {}, vi.fn(async () => ({ ok: true, attempts: 1, sqls: ['', ''] })))
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(true)
    const progress = meta[FILL_PROGRESS_KEY] as { tableFloors?: Record<string, number> }
    expect(progress?.tableFloors?.['t']).toBe(3)
    expect(detectLastUpdatedAiFloorForTable(session, 't')).toBe(3)
    expect(detectActualUpdateFloorForTable(session, 't')).toBe(null)
    expect(detectLastSummarizedAiFloor(session, 'table')).toBe(3)
    core.dispose()
  })

  it('非空更新时 per-table 游标与帧并存，两者一致', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    const { session, meta } = makeRunSession(core, chat, {}, vi.fn(async () => ({
      ok: true,
      attempts: 1,
      sqls: ["INSERT INTO t (c) VALUES ('x')"]
    })))
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(true)
    const progress = meta[FILL_PROGRESS_KEY] as { tableFloors?: Record<string, number> }
    expect(progress?.tableFloors?.['t']).toBe(1)
    expect(detectLastUpdatedAiFloorForTable(session, 't')).toBe(1)
    expect(detectActualUpdateFloorForTable(session, 't')).toBe(1)
    core.dispose()
  })

  it('多表填表时所有目标表都推进游标', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    core.run('CREATE TABLE s (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    const { session, meta } = makeRunSession(core, chat, {}, vi.fn(async () => ({ ok: true, attempts: 1, sqls: [] })))
    const result = await runManualFill(session, { targetTables: ['t', 's'] })
    expect(result.ok).toBe(true)
    const progress = meta[FILL_PROGRESS_KEY] as { tableFloors?: Record<string, number> }
    expect(progress?.tableFloors).toEqual({ t: 1, s: 1 })
    core.dispose()
  })

  it('失败的 bucket 不推进 per-table 游标', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    const { session, meta } = makeRunSession(core, chat, {}, vi.fn(async () => ({ ok: false, attempts: 2, error: 'boom' })))
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(false)
    expect(meta[FILL_PROGRESS_KEY]).toBeUndefined()
    core.dispose()
  })
})

describe('rollbackFillProgress 清理 per-table 游标', () => {
  function makeMetaSession(initial: Record<string, unknown> | null) {
    const meta: Record<string, unknown> = {}
    if (initial) meta[FILL_PROGRESS_KEY] = initial
    const session = {
      chat: {
        readChatMetadata: (k: string) => meta[k],
        writeChatMetadata: (k: string, v: unknown) => {
          if (v === undefined) delete meta[k]
          else meta[k] = v
        },
      },
    } as unknown as CranialNerveSession
    return { session, meta }
  }

  it('游标楼 >= 被删楼时清掉对应表的游标', () => {
    const { session, meta } = makeMetaSession({ tableFloor: 2, tableFloors: { t: 5, x: 2 } })
    rollbackFillProgress(session, 4)
    expect(meta[FILL_PROGRESS_KEY]).toEqual({ tableFloor: 2, tableFloors: { x: 2 } })
  })

  it('全部表的游标都 >= 被删楼时 tableFloors 整体消失', () => {
    const { session, meta } = makeMetaSession({ tableFloor: 1, tableFloors: { t: 5, x: 3 } })
    rollbackFillProgress(session, 3)
    expect(meta[FILL_PROGRESS_KEY]).toEqual({ tableFloor: 1 })
  })

  it('游标全 < 被删楼时 tableFloors 保持不变', () => {
    const { session, meta } = makeMetaSession({ tableFloor: 2, tableFloors: { t: 1, x: 1 } })
    rollbackFillProgress(session, 4)
    expect(meta[FILL_PROGRESS_KEY]).toEqual({ tableFloor: 2, tableFloors: { t: 1, x: 1 } })
  })
})

describe('detect 函数：元数据优先 + 帧扫描兜底', () => {
  it('detectLastUpdatedAiFloorForTable 元数据优先于帧扫描', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: false, is_system: false, mes: 'a2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
    ]
    const session = makeSession(chat, { 1: 'ai_fill_table' })
    session.chat.writeChatMetadata(FILL_PROGRESS_KEY, { tableFloors: { t: 3 } })
    expect(detectLastUpdatedAiFloorForTable(session, 't')).toBe(3)
  })

  it('detectLastUpdatedAiFloorForTable 无元数据时帧扫描兜底', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: false, is_system: false, mes: 'a2', extra: {} },
    ]
    const session = makeSession(chat, { 2: 'ai_fill_table' })
    expect(detectLastUpdatedAiFloorForTable(session, 't')).toBe(2)
  })

  it('detectActualUpdateFloorForTable 只认真实 SQL 提及该表的帧', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: false, is_system: false, mes: 'a2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
    ]
    for (const [idStr, statements] of Object.entries({ 1: ['INSERT INTO t VALUES (1)'], 3: ['INSERT INTO s VALUES (1)'] }) as Array<[string, string[]]>) {
      const id = Number(idStr)
      ;(chat[id] as FakeMessage).extra = { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame('ai_fill_table', statements)) }
    }
    const session = makeSession(chat, {})
    expect(detectActualUpdateFloorForTable(session, 't')).toBe(1)
    expect(detectActualUpdateFloorForTable(session, 's')).toBe(3)
    expect(detectActualUpdateFloorForTable(session, 'other')).toBe(null)
  })

  it('detectLastSummarizedAiFloor 帧扫描与元数据取较大值（空更新楼层不再被低估）', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: false, is_system: false, mes: 'a2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
    ]
    const session = makeSession(chat, { 1: 'ai_fill_table' })
    session.chat.writeChatMetadata(FILL_PROGRESS_KEY, { tableFloor: 3 })
    expect(detectLastSummarizedAiFloor(session, 'table')).toBe(3)
  })

  it('detectLastSummarizedAiFloor 元数据越界时仍以帧为准', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    const session = makeSession(chat, { 1: 'ai_fill_table' })
    session.chat.writeChatMetadata(FILL_PROGRESS_KEY, { tableFloor: 5 })
    expect(detectLastSummarizedAiFloor(session, 'table')).toBe(1)
  })
})

describe('填表中途切换聊天中止', () => {
  it('editor 返回后聊天已切换：中止填表、不推进游标、状态重置', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    let chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    const states: Array<{ busy: boolean, runMode: string | null }> = []
    const unsub = subscribeFillState((b, r) => states.push({ busy: b, runMode: r }))
    const { session, meta } = makeRunSession(core, () => chat, {}, vi.fn(async () => {
      chat = [
        { is_user: true, is_system: false, mes: 'uNew', extra: {} },
        { is_user: false, is_system: false, mes: 'aNew', extra: {} },
      ]
      return { ok: true, attempts: 1, sqls: ["INSERT INTO t (c) VALUES ('x')"] }
    }))
    const result = await runManualFill(session, { targetTables: ['t'] })
    unsub()
    expect(result.ok).toBe(false)
    expect(result.error).toBe('聊天已切换，填表已中止')
    expect(meta[FILL_PROGRESS_KEY]).toBeUndefined()
    expect(states[states.length - 1]).toEqual({ busy: false, runMode: null })
    core.dispose()
  })

  it('聊天未切换时正常完成并落帧', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    const { session, meta } = makeRunSession(core, chat, {}, vi.fn(async () => ({
      ok: true,
      attempts: 1,
      sqls: ["INSERT INTO t (c) VALUES ('x')"]
    })))
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(true)
    expect(meta[FILL_PROGRESS_KEY]).toBeDefined()
    core.dispose()
  })
})
