import { describe, expect, it, vi } from 'vitest'
import { detectLastSummarizedAiFloor, runManualCatchUp, subscribeFillState } from '../src/core/table/fill-orchestrator'
import createFrameRepo from '../src/db/sqlite/storage-frame-repo'
import { createPersistContext, appendSqlLog, writeCheckpoint } from '../src/db/sqlite/frame-persist'
import SqliteCore from '../src/db/sqlite/core'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
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

type FrameReason = SqlBatchOperation['reason'] | SqlBatchOperation['reason'][]

function makeFrame(reason: FrameReason): StorageFrame {
  const reasons = Array.isArray(reason) ? reason : [reason]
  return {
    version: 2,
    logEntries: [{ seq: 1, createdAt: 0, operations: reasons.map((r) => ({ kind: 'sql_batch', statements: ['INSERT INTO t VALUES (1)'], reason: r })) }],
    checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: { tables: [] } },
  }
}

function makeSession(chat: FakeMessage[], frames: Record<number, FrameReason>): CranialNerveSession {
  for (const [idStr, reason] of Object.entries(frames) as Array<[string, FrameReason]>) {
    const id = Number(idStr)
    ;(chat[id] as FakeMessage).extra = { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame(reason)) }
  }
  const gateway = {
    getChat: () => chat,
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      const m = chat[id]
      if (!m) return
      if (!m.extra) m.extra = {}
      m.extra[key] = value
    },
  } as unknown as ChatGateway
  const repo = createFrameRepo(gateway)
  return {
    getSyncBridgeRepo: () => repo,
    chat: { getChat: () => chat },
  } as unknown as CranialNerveSession
}

interface FakeMessage {
  is_user: boolean
  is_system: boolean
  mes: string
  extra: Record<string, unknown>
}

describe('detectLastSummarizedAiFloor', () => {
  it('返回最后一个含 ai_fill 的 AI 楼层', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'ai1', extra: {} },
      { is_user: false, is_system: false, mes: 'ai2', extra: {} },
      { is_user: false, is_system: false, mes: 'ai3', extra: {} },
    ]
    const session = makeSession(chat, { 1: 'ai_fill_table', 2: 'manual_edit', 3: 'ai_fill_table' })
    expect(detectLastSummarizedAiFloor(session)).toBe(3)
  })

  it('只有 manual_edit 无 ai_fill 时返回 null', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'ai1', extra: {} },
    ]
    const session = makeSession(chat, { 1: 'manual_edit' })
    expect(detectLastSummarizedAiFloor(session)).toBe(null)
  })

  it('无 repo 时返回 null', () => {
    const chat: FakeMessage[] = [{ is_user: true, is_system: false, mes: 'hi', extra: {} }]
    const session = {
      getSyncBridgeRepo: () => null,
      chat: { getChat: () => chat },
    } as unknown as CranialNerveSession
    expect(detectLastSummarizedAiFloor(session)).toBe(null)
  })

  it('table 场景只识别 ai_fill_table 与 ai_fill（merged），不误判 ai_fill_chronicle', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'ai1', extra: {} },
      { is_user: false, is_system: false, mes: 'ai2', extra: {} },
    ]
    const session = makeSession(chat, { 1: 'ai_fill_chronicle', 2: 'ai_fill_table' })
    expect(detectLastSummarizedAiFloor(session, 'table')).toBe(2)
  })

  it('chronicle 场景只识别 ai_fill_chronicle 与 ai_fill（merged），不误判 ai_fill_table', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'ai1', extra: {} },
      { is_user: false, is_system: false, mes: 'ai2', extra: {} },
    ]
    const session = makeSession(chat, { 1: 'ai_fill_table', 2: 'ai_fill_chronicle' })
    expect(detectLastSummarizedAiFloor(session, 'chronicle')).toBe(2)
  })

  it('table 场景不把纯纪要生成误判为表格已总结', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'ai1', extra: {} },
    ]
    const session = makeSession(chat, { 1: 'ai_fill_chronicle' })
    expect(detectLastSummarizedAiFloor(session, 'table')).toBe(null)
  })

  it('merged 记两条 reason，table 与 chronicle 各自识别', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'ai1', extra: {} },
    ]
    const session = makeSession(chat, { 1: ['ai_fill_table', 'ai_fill_chronicle'] })
    expect(detectLastSummarizedAiFloor(session, 'table')).toBe(1)
    expect(detectLastSummarizedAiFloor(session, 'chronicle')).toBe(1)
  })

  it('帧只带 summarizedReasons（log 已被手动 checkpoint 清空）时仍识别', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'ai1', extra: {} },
    ]
    const session = makeSession(chat, {})
    const repo = session.getSyncBridgeRepo()!
    repo.saveFrame(1, {
      version: 2,
      logEntries: [],
      summarizedReasons: ['ai_fill_table'],
    })
    expect(detectLastSummarizedAiFloor(session, 'table')).toBe(1)
    expect(detectLastSummarizedAiFloor(session, 'chronicle')).toBe(null)
  })

  it('端到端：手动 checkpoint 清空 log 后 detect 仍推进（latest-only 手动编辑场景）', async () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'ai1', extra: {} },
    ]
    const session = makeSession(chat, {})
    const core = new SqliteCore()
    await core.init()
    const ctx = createPersistContext(session.getSyncBridgeRepo()!, core)
    appendSqlLog(ctx, 1, [{ kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('a')"], reason: 'ai_fill_table' }])
    writeCheckpoint(ctx, 1, 'manual')
    expect(detectLastSummarizedAiFloor(session, 'table')).toBe(1)
    expect(detectLastSummarizedAiFloor(session, 'chronicle')).toBe(null)
    core.dispose()
  })
})

describe('runManualCatchUp 切片与 merged 范围', () => {
  function makePreset() {
    return { id: 'p1', name: 'p', baseURL: 'http://x', apiKey: 'k', model: 'm', maxTokens: 100, temperature: 0, topP: 1, frequencyPenalty: 0, presencePenalty: 0, seed: null, stream: false, responseFormat: 'none' as const, customIncludeBody: '', customExcludeBody: '', customIncludeHeaders: '' }
  }

  function makeRunSession(core: SqliteCore, chat: FakeMessage[], frames: Record<number, FrameReason>, editorRun: (ctx: { segments: { content: string }[] }) => Promise<any>): CranialNerveSession {
    for (const [idStr, reason] of Object.entries(frames) as Array<[string, FrameReason]>) {
      const id = Number(idStr)
      ;(chat[id] as FakeMessage).extra = { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame(reason)) }
    }
    const gateway = {
      getChat: () => chat,
      readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
      writeMessageExtra: (id: number, key: string, value: unknown) => {
        const m = chat[id]; if (!m) return; if (!m.extra) m.extra = {}; m.extra[key] = value
      },
      saveChat: async () => {},
    } as unknown as ChatGateway
    const syncBridge = new SqliteSyncBridge(core, gateway)
    return {
      core,
      getConfig: () => ({
        aiPresets: [], activeAiPresetId: '', vector: { embeddingEndpoint: '', embeddingApiKey: '', embeddingModel: '', rerankEndpoint: '', rerankApiKey: '', rerankModel: '' },
        vectorEnabled: false, snapshotStrategy: 'every-message',
        prompt: { tableEdit: { presets: [], activeId: '', defaultId: '' }, chronicleGen: { presets: [], activeId: '', defaultId: '' }, chronicleRecall: { presets: [], activeId: '', defaultId: '' } },
        tableFill: { autoFillTrigger: 'off', regenerateFill: false, contextDepth: 3, updateFrequency: 1, batchSize: 3, skipFloors: 0, maxRetries: 3, manualUpdateContextDepth: null, manualUpdateBatchSize: null, manualSelectedTables: [], hasManualSelection: false, manualIncludeChronicle: false },
        chronicleFill: { autoFillTrigger: 'off', regenerateFill: false, contextDepth: 3, updateFrequency: 1, batchSize: 3, skipFloors: 0, maxRetries: 3, chronicleSendLatestRows: 10, manualUpdateContextDepth: null, manualUpdateBatchSize: null, manualIncludeTables: false },
        maxRecallItems: 25, recallEnabled: true, recallRecentFixedInjectCount: 5, recallMinScore: 0.45, tableFillPresetId: 'p1', chronicleGenPresetId: 'p2',
        recallPresetId: '', recallContextDepth: 5, retainFloors: 100,
        pending: { aiCallTimeoutMs: 60000, aiTimeoutRetries: 1, listModelsTimeoutMs: 10000, writeQueueDrainTimeoutMs: 8000, summarizeOnManualAbort: false, minSummaryLength: 0 },
        tableTemplate: { presets: [], activeId: '', defaultId: '' },
        chronicleTableDef: { name: 'cn_chronicle', displayName: '纪要表', columns: [{ name: 'key', displayName: '编码', type: 'TEXT' }] },
      }),
      getAiPresetForScene: () => makePreset(),
      getTemplate: () => ({ tables: [{ name: 't', displayName: 't', columns: [{ name: 'c', displayName: 'c', type: 'TEXT' }], enabled: true }] }),
      chat: { getChat: () => chat },
      getActiveSegments: () => [{ id: 's1', name: '正文', role: 'user' as const, content: '正文: {{conversation}}' }],
      worldbook: { getCurrentCharLorebookName: () => null, loadLorebook: async () => ({ entries: {} }) },
      getTableEditor: () => ({ run: editorRun }),
      getSyncBridgeRepo: () => syncBridge.getRepo(),
      applySnapshot: () => {},
      getProgressNotifier: () => undefined,
      getWriteQueue: () => ({ enqueue: (fn: () => Promise<any>) => fn() }),
      getCurrentTemplateId: () => null,
      cleanupOldSnapshots: () => {},
      getChatToken: () => 'test',
    } as unknown as CranialNerveSession
  }

  it('fromIdx = lastSummarized+1，sliceMessages 含下一轮起始 user', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
      { is_user: true, is_system: false, mes: 'u4', extra: {} },
      { is_user: false, is_system: false, mes: 'a5', extra: {} },
    ]
    const capturedList: string[] = []
    const session = makeRunSession(core, chat, { 1: 'ai_fill_table' }, vi.fn(async (ctx: { segments: { content: string }[] }) => {
      capturedList.push(ctx.segments.map((s) => s.content).join('\n'))
      return { ok: true, attempts: 1, lastSql: '' }
    }))
    const result = await runManualCatchUp(session, { targetTables: ['t'], batchSize: 10 })
    if (!result.ok) console.error('catchup error:', result.error)
    expect(result.ok).toBe(true)
    expect(capturedList).toHaveLength(1)
    expect(capturedList[0]).toContain('u2')
    expect(capturedList[0]).toContain('a5')
    expect(capturedList[0]).not.toContain('u0')
    core.dispose()
  })

  it('merged 追平 fromIdx 取 max(tableLast, chronicleLast)+1', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
      { is_user: true, is_system: false, mes: 'u4', extra: {} },
      { is_user: false, is_system: false, mes: 'a5', extra: {} },
    ]
    const capturedList: string[] = []
    const session = makeRunSession(core, chat, { 1: 'ai_fill_table', 3: 'ai_fill_chronicle' }, vi.fn(async (ctx: { segments: { content: string }[] }) => {
      capturedList.push(ctx.segments.map((s) => s.content).join('\n'))
      return { ok: true, attempts: 1, lastSql: '' }
    }))
    const result = await runManualCatchUp(session, { runMode: 'merged', fillCfgSource: 'table', targetTables: ['t'] })
    if (!result.ok) console.error('merged catchup error:', result.error)
    expect(result.ok).toBe(true)
    expect(capturedList.length).toBeGreaterThanOrEqual(1)
    expect(capturedList[0]).toContain('u4')
    expect(capturedList[0]).toContain('a5')
    expect(capturedList[0]).not.toContain('a3')
    core.dispose()
  })

  it('bucket 按 AI 楼切，每桶 batchSize 个 AI 楼', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
      { is_user: true, is_system: false, mes: 'u4', extra: {} },
      { is_user: false, is_system: false, mes: 'a5', extra: {} },
    ]
    const capturedList: string[] = []
    const session = makeRunSession(core, chat, {}, vi.fn(async (ctx: { segments: { content: string }[] }) => {
      capturedList.push(ctx.segments.map((s) => s.content).join('\n'))
      return { ok: true, attempts: 1, lastSql: '' }
    }))
    await runManualCatchUp(session, { targetTables: ['t'], batchSize: 2 })
    expect(capturedList).toHaveLength(2)
    expect(capturedList[0]).toContain('u0')
    expect(capturedList[0]).toContain('a1')
    expect(capturedList[0]).toContain('u2')
    expect(capturedList[0]).toContain('a3')
    expect(capturedList[1]).toContain('u4')
    expect(capturedList[1]).toContain('a5')
    core.dispose()
  })

  it('batchSize 大于 AI 楼数时合并为 1 桶', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
    ]
    const capturedList: string[] = []
    const session = makeRunSession(core, chat, {}, vi.fn(async (ctx: { segments: { content: string }[] }) => {
      capturedList.push(ctx.segments.map((s) => s.content).join('\n'))
      return { ok: true, attempts: 1, lastSql: '' }
    }))
    await runManualCatchUp(session, { targetTables: ['t'], batchSize: 10 })
    expect(capturedList).toHaveLength(1)
    expect(capturedList[0]).toContain('u0')
    expect(capturedList[0]).toContain('a3')
    core.dispose()
  })

  it('abort 后停止后续桶并返回 aborted', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
    ]
    const ctrl = new AbortController()
    let runCalls = 0
    const session = makeRunSession(core, chat, {}, vi.fn(async () => {
      runCalls++
      if (runCalls === 1) ctrl.abort()
      return { ok: true, attempts: 1, lastSql: '' }
    }))
    const result = await runManualCatchUp(session, { targetTables: ['t'], batchSize: 1, signal: ctrl.signal })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('aborted')
    expect(runCalls).toBe(1)
    core.dispose()
  })

  it('executeFill 期间 fillState 通知 busy + runMode', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    const states: Array<{ busy: boolean, runMode: string | null }> = []
    const unsub = subscribeFillState((b, r) => states.push({ busy: b, runMode: r }))
    const session = makeRunSession(core, chat, {}, vi.fn(async () => ({ ok: true, attempts: 1, lastSql: '' })))
    await runManualCatchUp(session, { targetTables: ['t'], batchSize: 10 })
    unsub()
    expect(states.length).toBeGreaterThanOrEqual(2)
    expect(states[0]).toEqual({ busy: true, runMode: 'table' })
    expect(states[states.length - 1]).toEqual({ busy: false, runMode: null })
    core.dispose()
  })
})
