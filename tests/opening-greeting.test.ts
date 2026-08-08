import { describe, expect, it, vi } from 'vitest'
import { isGreetingFloor, isFirstUserFloorAfterGreeting } from '../src/shared/chat-role'
import { runManualCatchUp, onMessageSentForFill } from '../src/core/table/fill-orchestrator'
import { readKeymap } from '../src/core/table/chronicle-keymap'
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

interface FakeRole {
  is_user?: boolean
  is_system?: boolean
}

function ai(): FakeRole {
  return { is_user: false, is_system: false }
}

function user(): FakeRole {
  return { is_user: true, is_system: false }
}

function system(): FakeRole {
  return { is_user: false, is_system: true }
}

describe('isGreetingFloor', () => {
  it('chat[0] 是 AI 且对象即首条 → true', () => {
    const chat = [ai(), user()]
    expect(isGreetingFloor(chat, chat[0]!)).toBe(true)
  })

  it('chat[0] 是 user → false（无开场白）', () => {
    const chat = [user(), ai()]
    expect(isGreetingFloor(chat, chat[0]!)).toBe(false)
  })

  it('chat[0] 是 system → false', () => {
    const chat = [system(), ai()]
    expect(isGreetingFloor(chat, chat[0]!)).toBe(false)
  })

  it('非首条对象 → false（恒等判定，不看索引位置）', () => {
    const chat = [ai(), user()]
    expect(isGreetingFloor(chat, chat[1]!)).toBe(false)
  })

  it('空数组 → false', () => {
    expect(isGreetingFloor([], ai())).toBe(false)
  })
})

describe('isFirstUserFloorAfterGreeting', () => {
  it('[AI, user] 第一个 user 楼 = 索引 1', () => {
    const chat = [ai(), user()]
    expect(isFirstUserFloorAfterGreeting(chat, 1)).toBe(true)
    expect(isFirstUserFloorAfterGreeting(chat, 0)).toBe(false)
  })

  it('[AI, system, user] 跳过 system 命中索引 2', () => {
    const chat = [ai(), system(), user()]
    expect(isFirstUserFloorAfterGreeting(chat, 2)).toBe(true)
    expect(isFirstUserFloorAfterGreeting(chat, 1)).toBe(false)
  })

  it('[AI, user, user] 只有第一个 user 楼命中', () => {
    const chat = [ai(), user(), user()]
    expect(isFirstUserFloorAfterGreeting(chat, 1)).toBe(true)
    expect(isFirstUserFloorAfterGreeting(chat, 2)).toBe(false)
  })

  it('[user, AI] 无开场白 → false', () => {
    const chat = [user(), ai()]
    expect(isFirstUserFloorAfterGreeting(chat, 0)).toBe(false)
    expect(isFirstUserFloorAfterGreeting(chat, 1)).toBe(false)
  })

  it('[system, user] chat[0] 是 system → false', () => {
    const chat = [system(), user()]
    expect(isFirstUserFloorAfterGreeting(chat, 1)).toBe(false)
  })

  it('[AI] 无 user 楼 → false', () => {
    const chat = [ai()]
    expect(isFirstUserFloorAfterGreeting(chat, 1)).toBe(false)
  })

  it('[AI, AI] 开场白后先遇 AI → false', () => {
    const chat = [ai(), ai()]
    expect(isFirstUserFloorAfterGreeting(chat, 1)).toBe(false)
  })

  it('空数组 → false', () => {
    expect(isFirstUserFloorAfterGreeting([], 0)).toBe(false)
  })
})

interface FakeMessage {
  is_user: boolean
  is_system: boolean
  mes: string
  extra: Record<string, unknown>
}

function makePreset() {
  return { id: 'p1', name: 'p', baseURL: 'http://x', apiKey: 'k', model: 'm', maxTokens: 100, temperature: 0, topP: 1, frequencyPenalty: 0, presencePenalty: 0, seed: null, stream: false, responseFormat: 'none' as const, customIncludeBody: '', customExcludeBody: '', customIncludeHeaders: '' }
}

interface EditorOptions {
  floorSeqs?: (number | null)[]
}

function makeRunSession(core: SqliteCore, chat: FakeMessage[], editorRun: (ctx: { segments: { content: string }[] }, options?: EditorOptions) => Promise<any>): { session: CranialNerveSession, meta: Record<string, unknown> } {
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
  const session = {
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
  return { session, meta }
}

describe('开场白跳过纪要（楼层收集）', () => {
  it('merged 追平跳过开场白，序号从第一条真实 AI 回复重排（CN0001）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: false, is_system: false, mes: 'greeting 文本', extra: {} },
      { is_user: true, is_system: false, mes: 'u1', extra: {} },
      { is_user: false, is_system: false, mes: 'a2', extra: {} },
      { is_user: true, is_system: false, mes: 'u3', extra: {} },
      { is_user: false, is_system: false, mes: 'a4', extra: {} },
    ]
    let captured = ''
    let capturedFloorSeqs: (number | null)[] | undefined
    const { session } = makeRunSession(core, chat, vi.fn(async (ctx: { segments: { content: string }[] }, options?: EditorOptions) => {
      captured = ctx.segments.map((s) => s.content).join('\n')
      capturedFloorSeqs = options?.floorSeqs
      return { ok: true, attempts: 1, sqls: [] }
    }))
    const result = await runManualCatchUp(session, { runMode: 'merged', fillCfgSource: 'table', targetTables: ['t'], batchSize: 10 })
    expect(result.ok).toBe(true)
    expect(capturedFloorSeqs).toEqual([1, 2])
    expect(captured).toContain('u1')
    expect(captured).toContain('a2')
    expect(captured).toContain('a4')
    expect(captured).not.toContain('greeting 文本')
    expect(readKeymap(session)).toEqual({ 2: 1, 4: 2 })
    core.dispose()
  })

  it('无开场白（chat[0] 是 user）时楼层照常追平，序号从楼层 1 递增', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
    ]
    let capturedFloorSeqs: (number | null)[] | undefined
    const { session } = makeRunSession(core, chat, vi.fn(async (_ctx, options) => {
      capturedFloorSeqs = options?.floorSeqs
      return { ok: true, attempts: 1, sqls: [] }
    }))
    const result = await runManualCatchUp(session, { runMode: 'merged', fillCfgSource: 'table', targetTables: ['t'], batchSize: 10 })
    expect(result.ok).toBe(true)
    expect(capturedFloorSeqs).toEqual([1, 2])
    core.dispose()
  })

  it('greeting-only 聊天无真实 AI 楼层可追平', async () => {
    const core = new SqliteCore()
    await core.init()
    const chat: FakeMessage[] = [
      { is_user: false, is_system: false, mes: 'greeting', extra: {} },
    ]
    const { session } = makeRunSession(core, chat, vi.fn(async () => ({ ok: true, attempts: 1, sqls: [] })))
    const result = await runManualCatchUp(session, { targetTables: ['t'], batchSize: 10 })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('无 AI 楼层可追平')
    core.dispose()
  })

  it('after-send 只填开场白之后的真实 AI 楼，上下文中不含开场白文本', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const chat: FakeMessage[] = [
      { is_user: false, is_system: false, mes: 'greeting 文本', extra: {} },
      { is_user: true, is_system: false, mes: 'u1', extra: {} },
      { is_user: false, is_system: false, mes: 'a2', extra: {} },
      { is_user: true, is_system: false, mes: 'u3', extra: {} },
    ]
    let captured = ''
    const { session } = makeRunSession(core, chat, vi.fn(async (ctx: { segments: { content: string }[] }) => {
      captured = ctx.segments.map((s) => s.content).join('\n')
      return { ok: true, attempts: 1, sqls: [] }
    }))
    const baseCfg = session.getConfig()
    ;(session as unknown as { getConfig: () => unknown }).getConfig = () => ({
      ...baseCfg,
      tableFill: { ...baseCfg.tableFill, autoFillTrigger: 'after-send' },
      chronicleFill: { ...baseCfg.chronicleFill, autoFillTrigger: 'off' },
    })
    await onMessageSentForFill(session, 3)
    expect(captured).toContain('a2')
    expect(captured).not.toContain('greeting 文本')
    core.dispose()
  })
})
