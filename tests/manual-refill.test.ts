import { describe, expect, it, vi } from 'vitest'
import SqliteCore from '../src/db/sqlite/core'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
import { runManualFill, onMessageSentForFill } from '../src/core/table/fill-orchestrator'
import { persistFill, createPersistContext } from '../src/db/sqlite/frame-persist'
import { CHRONICLE_TABLE_NAME } from '../src/shared/constants/chronicle'
import type { ChatGateway } from '../src/db/gateways/chat'
import type { CranialNerveSession } from '../src/core/session'
import type { AiPreset } from '../src/shared/types/config'

vi.mock('@db/gateways/host-context', () => ({
  getHostContext: () => ({ characters: {}, characterId: 0, chatId: 'test' }),
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
}))
vi.mock('@db/gateways/host-state', () => ({
  getPersonaDescription: () => '',
  getCharDescription: () => '',
  getUserName: () => 'User',
}))

interface FakeMessage {
  is_user: boolean
  is_system: boolean
  mes: string
  extra: Record<string, unknown>
}

function makePreset(): AiPreset {
  return {
    id: 'p1', name: 'p', baseURL: 'http://x', apiKey: 'k', model: 'm',
    maxTokens: 100, temperature: 0, topP: 1, frequencyPenalty: 0, presencePenalty: 0,
    seed: null, stream: false, responseFormat: 'none', customIncludeBody: '', customExcludeBody: '', customIncludeHeaders: '',
  }
}

function makeSession(core: SqliteCore, chat: FakeMessage[], editorRun: () => Promise<any>): CranialNerveSession {
  const gateway = {
    getChat: () => chat,
    getLastUserMessageId: () => null,
    appendKeywordsToMessage: () => {},
    readChatMetadata: () => undefined,
    writeChatMetadata: () => {},
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      const m = chat[id]
      if (!m) return
      if (!m.extra) m.extra = {}
      m.extra[key] = value
    },
    saveChat: async () => {},
  } as unknown as ChatGateway
  const syncBridge = new SqliteSyncBridge(core, gateway)
  return {
    core,
    getConfig: () => ({
      aiPresets: [], activeAiPresetId: '', vector: {
        embeddingEndpoint: '', embeddingApiKey: '', embeddingModel: '', rerankEndpoint: '', rerankApiKey: '', rerankModel: '',
      },
      vectorEnabled: false, snapshotStrategy: 'every-message',
      prompt: {
        tableEdit: { presets: [], activeId: '', defaultId: '' },
        chronicleGen: { presets: [], activeId: '', defaultId: '' },
        chronicleRecall: { presets: [], activeId: '', defaultId: '' },
      },
      tableFill: {
        autoFillTrigger: 'after-ai', regenerateFill: true, contextDepth: 3, updateFrequency: 1, batchSize: 3, skipFloors: 0, maxRetries: 3,
        manualUpdateContextDepth: null, manualUpdateBatchSize: null, manualSelectedTables: []
      },
      chronicleFill: {
        autoFillTrigger: 'off', regenerateFill: false, contextDepth: 3, updateFrequency: 1, batchSize: 3, skipFloors: 0, maxRetries: 3, chronicleSendLatestRows: 10,
        manualUpdateContextDepth: null, manualUpdateBatchSize: null,
      },
      maxRecallItems: 25, recallEnabled: true, recallRecentFixedInjectCount: 5, recallMinScore: 0.45, tableFillPresetId: 'p1', chronicleGenPresetId: '',
      recallPresetId: '', recallContextDepth: 5, retainFloors: 100, checkpointInterval: 20,
      pending: { aiCallTimeoutMs: 60000, aiTimeoutRetries: 1, listModelsTimeoutMs: 10000, writeQueueDrainTimeoutMs: 8000, summarizeOnManualAbort: false, minSummaryLength: 0 },
      tableTemplate: { presets: [], activeId: '', defaultId: '' },
    }),
    getAiPresetForScene: () => makePreset(),
    getTemplate: () => ({ tables: [{ name: 't', displayName: 't', columns: [{ name: 'c', displayName: 'c', type: 'TEXT' }] }] }),
    chat: { getChat: () => chat, saveChat: vi.fn(async () => {}), readChatMetadata: () => undefined, writeChatMetadata: vi.fn() },
    getActiveSegments: () => [],
    worldbook: { getCurrentCharLorebookName: () => null, loadLorebook: async () => ({ entries: {} }) },
    getTableEditor: () => ({ run: editorRun }),
    getSyncBridgeRepo: () => syncBridge.getRepo(),
    applySnapshot: (snapshot: import('../src/shared/types/table').DatabaseSnapshot) => syncBridge.applySnapshotExternal(snapshot),
    getProgressNotifier: () => undefined,
    getWriteQueue: () => ({ enqueue: (fn: () => Promise<any>) => fn() }),
    getCurrentTemplateId: () => null,
    cleanupOldSnapshots: () => {},
    persistAfterFill: (messageId: number, ops: import('../src/shared/types/storage-frame').MutationOperation[]) => {
      const ctx = createPersistContext(syncBridge.getRepo(), core)
      persistFill(ctx, messageId, ops, { strategy: 'every-message', interval: 20, retainFloors: 100 })
    },
    getChatToken: () => 'test',
  } as unknown as CranialNerveSession
}

describe('runManualFill 重填分支', () => {
  it('clearBeforeFill 清空选中表后 AI 重填并持久化 DELETE+AI log', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    core.run("INSERT INTO t VALUES ('old')")
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const session = makeSession(core, chat, vi.fn(async () => {
      core.run("INSERT INTO t VALUES ('new')")
      return { ok: true, attempts: 1, sqls: ["INSERT INTO t VALUES ('new')"] }
    }))

    const repo = (session as unknown as { getSyncBridgeRepo: () => any }).getSyncBridgeRepo()
    persistFill(createPersistContext(repo, core), 0, [], { strategy: 'every-message', interval: 20, retainFloors: 100 })
    const result = await runManualFill(session, { clearBeforeFill: true, clearTables: ['t'], targetTables: ['t'] })

    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows[0]!.c).toBe('new')
    const frame = repo.loadFrame(0)
    expect(frame).not.toBeNull()
    expect(frame.logEntries).toHaveLength(2)
    expect(frame.logEntries[0].operations).toHaveLength(1)
    expect(frame.logEntries[0].operations[0].reason).toBe('manual_refill')
    expect(frame.logEntries[1].operations).toHaveLength(1)
    expect(frame.logEntries[1].operations[0].reason).toBe('ai_fill_table')
    core.dispose()
  })

  it('AI 失败时 applySnapshot 恢复旧数据且不持久化', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    core.run("INSERT INTO t VALUES ('old')")
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const session = makeSession(core, chat, vi.fn().mockResolvedValue({ ok: false, attempts: 3, error: 'AI fail' }))

    const result = await runManualFill(session, { clearBeforeFill: true, clearTables: ['t'], targetTables: ['t'] })

    expect(result.ok).toBe(false)
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows[0]!.c).toBe('old')
    const repo = (session as unknown as { getSyncBridgeRepo: () => any }).getSyncBridgeRepo()
    const frame = repo.loadFrame(0)
    expect(frame).toBeNull()
    core.dispose()
  })
})

describe('merged 模式 reason 按 SQL 内容精确拆分', () => {
  async function runMerged(core: SqliteCore, chat: FakeMessage[], sqls: string[]) {
    const session = makeSession(core, chat, vi.fn(async () => ({ ok: true, attempts: 1, sqls })))
    const baseCfg = (session as unknown as { getConfig: () => any }).getConfig()
    ;(session as unknown as { getConfig: () => any }).getConfig = () => ({
      ...baseCfg,
      chronicleTableDef: {
        name: CHRONICLE_TABLE_NAME,
        displayName: '纪要表',
        columns: [{ name: 'key', displayName: '编码', type: 'TEXT' }],
      },
    })
    const repo = (session as unknown as { getSyncBridgeRepo: () => any }).getSyncBridgeRepo()
    persistFill(createPersistContext(repo, core), 0, [], { strategy: 'every-message', interval: 20, retainFloors: 100 })
    await runManualFill(session, { runMode: 'merged', targetTables: ['t'] })
    return repo
  }

  function frameReasons(repo: any): (string | undefined)[] {
    const frame = repo.loadFrame(0) as import('../src/shared/types/storage-frame').StorageFrame
    return frame.logEntries.flatMap((e) => e.operations.map((o) => o.reason))
  }

  it('AI 只输出纪要 SQL 时只标 ai_fill_chronicle', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const repo = await runMerged(core, chat, ["INSERT INTO cn_chronicle (key) VALUES ('CN0001')"])
    expect(frameReasons(repo)).toEqual(['ai_fill_chronicle'])
    core.dispose()
  })

  it('AI 只输出普通表 SQL 时只标 ai_fill_table', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const repo = await runMerged(core, chat, ["INSERT INTO t (c) VALUES ('x')"])
    expect(frameReasons(repo)).toEqual(['ai_fill_table'])
    core.dispose()
  })

  it('AI 双输出时两条 reason 都标', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const repo = await runMerged(core, chat, ["INSERT INTO t (c) VALUES ('x'); INSERT INTO cn_chronicle (key) VALUES ('CN0002')"])
    expect(frameReasons(repo)).toEqual(['ai_fill_chronicle', 'ai_fill_table'])
    core.dispose()
  })

  it('SQL 未提及任何表时（空操作）不标任何 reason', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const repo = await runMerged(core, chat, ['SELECT 1'])
    expect(frameReasons(repo)).toEqual([])
    core.dispose()
  })

  it('多对象逐层落帧：每层各自帧、reason 逐条判定', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: false, is_system: false, mes: 'a2', extra: {} },
    ]
    const session = makeSession(core, chat, vi.fn(async () => ({
      ok: true,
      attempts: 1,
      sqls: ["INSERT INTO t (c) VALUES ('x')", "INSERT INTO cn_chronicle (key) VALUES ('CN0001')"],
    })))
    const baseCfg = (session as unknown as { getConfig: () => any }).getConfig()
    ;(session as unknown as { getConfig: () => any }).getConfig = () => ({
      ...baseCfg,
      chronicleTableDef: {
        name: CHRONICLE_TABLE_NAME,
        displayName: '纪要表',
        columns: [{ name: 'key', displayName: '编码', type: 'TEXT' }],
      },
    })
    const repo = (session as unknown as { getSyncBridgeRepo: () => any }).getSyncBridgeRepo()
    persistFill(createPersistContext(repo, core), 0, [], { strategy: 'every-message', interval: 20, retainFloors: 100 })
    const result = await runManualFill(session, { runMode: 'merged', targetTables: ['t'] })
    expect(result.ok).toBe(true)
    const frame0 = repo.loadFrame(0) as import('../src/shared/types/storage-frame').StorageFrame
    const frame1 = repo.loadFrame(1) as import('../src/shared/types/storage-frame').StorageFrame
    const reasons0 = frame0.logEntries.flatMap((e) => e.operations.map((o) => o.reason))
    const reasons1 = frame1.logEntries.flatMap((e) => e.operations.map((o) => o.reason))
    expect(reasons0).toEqual(['ai_fill_table'])
    expect(reasons1).toEqual(['ai_fill_chronicle'])
    core.dispose()
  })

  it('table 模式空 sql 对象不产生 op 但 metadata 进度推进', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: false, is_system: false, mes: 'a2', extra: {} },
    ]
    const session = makeSession(core, chat, vi.fn(async () => ({
      ok: true,
      attempts: 1,
      sqls: ['', "INSERT INTO t (c) VALUES ('x')"],
    })))
    const repo = (session as unknown as { getSyncBridgeRepo: () => any }).getSyncBridgeRepo()
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(true)
    const frame0 = repo.loadFrame(0)
    const frame1 = repo.loadFrame(1) as import('../src/shared/types/storage-frame').StorageFrame
    expect(frame0).toBeNull()
    expect(frame1.summarizedReasons).toEqual(['ai_fill_table'])
    expect(session.chat.writeChatMetadata).toHaveBeenCalledWith('CN_FILL_PROGRESS', expect.any(Object))
    core.dispose()
  })
})

describe('onMessageSentForFill after-send 截断', () => {
  it('按 contextDepth 截断 messages，只填上一轮附近（1 bucket 而非全量 2 bucket）', async () => {
    const core = new SqliteCore()
    await core.init()
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
      { is_user: true, is_system: false, mes: 'u4', extra: {} },
      { is_user: false, is_system: false, mes: 'a5', extra: {} },
      { is_user: true, is_system: false, mes: 'new', extra: {} },
    ]
    const editorRun = vi.fn(async () => ({ ok: true, attempts: 1, sqls: [] }))
    const session = makeSession(core, chat, editorRun)
    const baseCfg = (session as unknown as { getConfig: () => any }).getConfig()
    ;(session as unknown as { getConfig: () => any }).getConfig = () => ({
      ...baseCfg,
      tableFill: { ...baseCfg.tableFill, autoFillTrigger: 'off' },
      chronicleFill: { ...baseCfg.chronicleFill, autoFillTrigger: 'after-send', contextDepth: 3, batchSize: 3 },
      chronicleTableDef: { name: 'cn_chronicle', displayName: '纪要表', columns: [{ name: 'key', displayName: 'k', type: 'TEXT' }] },
    })
    await onMessageSentForFill(session, 6)
    expect(editorRun).toHaveBeenCalledTimes(1)
    core.dispose()
  })
})

describe('填表期间聊天切换', () => {
  it('chat 引用变化时丢弃落帧，不污染新聊天', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const session = makeSession(core, chat, vi.fn(async () => {
      session.chat.getChat = () => [{ is_user: false, is_system: false, mes: 'other', send_date: '', extra: {} }]
      return { ok: true, attempts: 1, sqls: ["INSERT INTO t VALUES ('x')"] }
    }))
    const repo = (session as unknown as { getSyncBridgeRepo: () => any }).getSyncBridgeRepo()
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(true)
    expect(repo.loadFrame(0)).toBeNull()
    core.dispose()
  })

  it('chat 引用未变化时正常落帧', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const session = makeSession(core, chat, vi.fn(async () => ({ ok: true, attempts: 1, sqls: ["INSERT INTO t VALUES ('x')"] })))
    const repo = (session as unknown as { getSyncBridgeRepo: () => any }).getSyncBridgeRepo()
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(true)
    expect(repo.loadFrame(0)).not.toBeNull()
    core.dispose()
  })
})

describe('填表成功后主动存盘', () => {
  it('fill 成功时调用 saveChat', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const session = makeSession(core, chat, vi.fn(async () => ({ ok: true, attempts: 1, sqls: ["INSERT INTO t VALUES ('x')"] })))
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(true)
    expect(session.chat.saveChat).toHaveBeenCalled()
    expect(session.chat.writeChatMetadata).toHaveBeenCalledWith('CN_FILL_PROGRESS', expect.any(Object))
    core.dispose()
  })

  it('fill 失败时不调用 saveChat', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const session = makeSession(core, chat, vi.fn().mockResolvedValue({ ok: false, attempts: 3, error: 'AI fail' }))
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(false)
    expect(session.chat.saveChat).not.toHaveBeenCalled()
    core.dispose()
  })
})
