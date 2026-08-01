import { describe, expect, it, vi } from 'vitest'
import SqliteCore from '../src/db/sqlite/core'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
import { runManualFill } from '../src/core/table/fill-orchestrator'
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
    seed: null, stream: false, customIncludeBody: '', customExcludeBody: '', customIncludeHeaders: '',
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
      vectorEnabled: false, maxRetries: 3, snapshotStrategy: 'every-message',
      prompt: {
        tableEdit: { presets: [], activeId: '', defaultId: '' },
        chronicleRecall: { presets: [], activeId: '', defaultId: '' },
      },
      tableFill: {
        autoFill: true, contextDepth: 3, updateFrequency: 1, batchSize: 3, skipFloors: 0, maxRetries: 3,
        manualUpdateContextDepth: null, manualUpdateBatchSize: null, manualSelectedTables: [], hasManualSelection: false,
      },
      maxRecallItems: 25, recallEnabled: true, chronicleGenEnabled: false, tableFillPresetId: 'p1',
      recallPresetId: '', recallContextDepth: 5, retainFloors: 100,
      pending: { aiCallTimeoutMs: 60000, aiTimeoutRetries: 1, listModelsTimeoutMs: 10000, writeQueueDrainTimeoutMs: 8000, summarizeOnManualAbort: false, minSummaryLength: 0 },
      tableTemplate: { presets: [], activeId: '', defaultId: '' },
    }),
    getAiPresetForScene: () => makePreset(),
    getTemplate: () => ({ tables: [{ name: 't', displayName: 't', columns: [{ name: 'c', displayName: 'c', type: 'TEXT' }] }] }),
    chat: { getChat: () => chat },
    getActiveSegments: () => [],
    worldbook: { getCurrentCharLorebookName: () => null, loadLorebook: async () => ({ entries: {} }) },
    getTableEditor: () => ({ run: editorRun }),
    getSyncBridgeRepo: () => syncBridge.getRepo(),
    applySnapshot: (snapshot: import('../src/shared/types/table').DatabaseSnapshot) => syncBridge.applySnapshotExternal(snapshot),
    getProgressNotifier: () => undefined,
    getWriteQueue: () => ({ enqueue: (fn: () => Promise<any>) => fn() }),
    getCurrentTemplateId: () => null,
    cleanupOldSnapshots: () => {},
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
      return { ok: true, attempts: 1, lastSql: "INSERT INTO t VALUES ('new')" }
    }))

    const result = await runManualFill(session, { clearBeforeFill: true, clearTables: ['t'], targetTables: ['t'], includeChronicle: false })

    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows[0]!.c).toBe('new')
    const repo = (session as unknown as { getSyncBridgeRepo: () => any }).getSyncBridgeRepo()
    const frame = repo.loadFrame(0)
    expect(frame).not.toBeNull()
    expect(frame.logEntries).toHaveLength(1)
    expect(frame.logEntries[0].operations).toHaveLength(2)
    expect(frame.logEntries[0].operations[0].reason).toBe('manual_refill')
    expect(frame.logEntries[0].operations[1].reason).toBe('ai_fill')
    core.dispose()
  })

  it('AI 失败时 applySnapshot 恢复旧数据且不持久化', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    core.run("INSERT INTO t VALUES ('old')")
    const chat: FakeMessage[] = [{ is_user: false, is_system: false, mes: 'story', extra: {} }]
    const session = makeSession(core, chat, vi.fn().mockResolvedValue({ ok: false, attempts: 3, error: 'AI fail' }))

    const result = await runManualFill(session, { clearBeforeFill: true, clearTables: ['t'], targetTables: ['t'], includeChronicle: false })

    expect(result.ok).toBe(false)
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows[0]!.c).toBe('old')
    const repo = (session as unknown as { getSyncBridgeRepo: () => any }).getSyncBridgeRepo()
    const frame = repo.loadFrame(0)
    expect(frame).toBeNull()
    core.dispose()
  })
})
