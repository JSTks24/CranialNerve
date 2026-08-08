import { describe, expect, it, vi } from 'vitest'
import { runManualFill, buildWorldbookContext } from '../src/core/table/fill-orchestrator'
import SqliteCore from '../src/db/sqlite/core'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
import type { ChatGateway } from '../src/db/gateways/chat'
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

interface FakeMessage {
  is_user: boolean
  is_system: boolean
  mes: string
  extra: Record<string, unknown>
}

function makePreset() {
  return { id: 'p1', name: 'p', baseURL: 'http://x', apiKey: 'k', model: 'm', maxTokens: 100, temperature: 0, topP: 1, frequencyPenalty: 0, presencePenalty: 0, seed: null, stream: false, responseFormat: 'none' as const, customIncludeBody: '', customExcludeBody: '', customIncludeHeaders: '' }
}

function makeRunSession(core: SqliteCore, chat: FakeMessage[], editorRun: (ctx: { segments: { content: string }[] }) => Promise<any>): CranialNerveSession {
  const meta: Record<string, unknown> = {}
  const gateway = {
    getChat: () => chat,
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      const m = chat[id]
      if (!m) return
      if (!m.extra) m.extra = {}
      m.extra[key] = value
    },
    readChatMetadata: (key: string) => meta[key],
    writeChatMetadata: (key: string, value: unknown) => {
      meta[key] = value
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
      tableFill: { autoFillTrigger: 'off', regenerateFill: false, contextDepth: 3, updateFrequency: 1, batchSize: 3, skipFloors: 0, maxRetries: 3, manualUpdateContextDepth: null, manualUpdateBatchSize: null, manualSelectedTables: [], manualIncludeChronicle: false },
      chronicleFill: { autoFillTrigger: 'off', regenerateFill: false, contextDepth: 3, updateFrequency: 1, batchSize: 3, skipFloors: 0, maxRetries: 3, chronicleSendLatestRows: 10, manualUpdateContextDepth: null, manualUpdateBatchSize: null },
      maxRecallItems: 25, recallEnabled: true, recallRecentFixedInjectCount: 5, recallMinScore: 0.45, recallFadeMinDepth: 2, tableFillPresetId: 'p1', chronicleGenPresetId: 'p2',
      recallPresetId: '', recallContextDepth: 5, retainFloors: 100, checkpointInterval: 20,
      pending: { aiCallTimeoutMs: 60000, aiTimeoutRetries: 1, listModelsTimeoutMs: 10000, writeQueueDrainTimeoutMs: 8000, summarizeOnManualAbort: false, minSummaryLength: 0 },
      tableTemplate: { presets: [], activeId: '', defaultId: '' },
      chronicleTableDef: { name: 'cn_chronicle', displayName: '纪要表', columns: [{ name: 'key', displayName: '编码', type: 'TEXT' }] },
    }),
    getAiPresetForScene: () => makePreset(),
    getTemplate: () => ({ tables: [{ name: 't', displayName: 't', columns: [{ name: 'c', displayName: 'c', type: 'TEXT' }], enabled: true }] }),
    chat: { getChat: () => chat, readChatMetadata: (key: string) => meta[key], writeChatMetadata: (key: string, value: unknown) => { meta[key] = value } },
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
    persistAfterFill: () => {},
    ensureBoundTemplate: () => {},
    finishFillBucket: () => {},
    getChatToken: () => 'test',
  } as unknown as CranialNerveSession
}

describe('fill conversationText 剥离召回 keys 行', () => {
  it('user 消息 keys 行被剥离，正文保留', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'CN0001 CN0002\n我今天去了咖啡馆', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    let captured = ''
    const session = makeRunSession(core, chat, vi.fn(async (ctx: { segments: { content: string }[] }) => {
      captured = ctx.segments.map((s) => s.content).join('\n')
      return { ok: true, attempts: 1, sqls: [] }
    }))
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(true)
    expect(captured).toContain('我今天去了咖啡馆')
    expect(captured).not.toContain('CN0001')
    expect(captured).not.toContain('CN0002')
    core.dispose()
  })

  it('无 keys 行的 user 消息原样进 prompt（防回归）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: '普通消息 CN0001 出现在句中也不剥', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    let captured = ''
    const session = makeRunSession(core, chat, vi.fn(async (ctx: { segments: { content: string }[] }) => {
      captured = ctx.segments.map((s) => s.content).join('\n')
      return { ok: true, attempts: 1, sqls: [] }
    }))
    const result = await runManualFill(session, { targetTables: ['t'] })
    expect(result.ok).toBe(true)
    expect(captured).toContain('普通消息 CN0001 出现在句中也不剥')
    core.dispose()
  })
})

describe('世界书扫描文本同步剥离', () => {
  const entries = {
    1: { uid: 1, key: ['CN0001'], keysecondary: ['咖啡馆'], content: '纪要A全文', comment: 'CN_auto_generated', constant: false, selective: true, position: 4, depth: 4, order: 100 },
    2: { uid: 2, key: ['咖啡馆'], keysecondary: [], content: '条目B内容', comment: '', constant: false, selective: false, position: 4, depth: 4, order: 90 },
  }

  function makeSessionWithBook(): CranialNerveSession {
    const core = new SqliteCore()
    const chat: FakeMessage[] = []
    const session = makeRunSession(core, chat, vi.fn(async (_ctx: { segments: { content: string }[] }) => ({ ok: true, attempts: 1, sqls: [] })))
    ;(session as unknown as { worldbook: unknown }).worldbook = {
      getCurrentCharLorebookName: () => 'charBook',
      loadLorebook: async () => ({ entries }),
    }
    return session
  }

  it('剥离前 keys 行会触发纪要条目激活（对照组）', async () => {
    const session = makeSessionWithBook()
    const result = await buildWorldbookContext(session, 'CN0001 CN0002\n我今天去了咖啡馆')
    expect(result).toContain('纪要A全文')
    expect(result).toContain('条目B内容')
  })

  it('剥离后 keys 行不再触发纪要条目激活，普通条目不受影响', async () => {
    const session = makeSessionWithBook()
    const result = await buildWorldbookContext(session, '我今天去了咖啡馆')
    expect(result).not.toContain('纪要A全文')
    expect(result).toContain('条目B内容')
  })
})
