import { describe, expect, it } from 'vitest'
import SqliteCore from '../src/db/sqlite/core'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
import { persistFill, createPersistContext, retainRecentFrames } from '../src/db/sqlite/frame-persist'
import { FRAME_FIELD_PREFIX } from '../src/shared/constants/msg-fields'
import type { ChatGateway } from '../src/db/gateways/chat'
import type { StorageFrame, MutationOperation, SqlBatchOperation } from '../src/shared/types/storage-frame'

interface FakeMessage {
  is_user: boolean
  mes: string
  extra: Record<string, unknown>
}

function makeChatGateway(size: number): { gateway: ChatGateway; chat: FakeMessage[] } {
  const chat: FakeMessage[] = []
  for (let i = 0; i < size; i++) {
    chat.push({ is_user: i % 2 === 0, mes: `m${i}`, extra: {} })
  }
  const gateway = {
    getChat: () => chat,
    getLastUserMessageId: () => null,
    appendKeywordsToMessage: () => {},
    readChatMetadata: () => undefined,
    writeChatMetadata: () => {},
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      const msg = chat[id]
      if (!msg) return
      if (!msg.extra) msg.extra = {}
      msg.extra[key] = value
    },
    saveChat: async () => {},
  } as unknown as ChatGateway
  return { gateway, chat }
}

function loadFrame(gateway: ChatGateway, id: number): StorageFrame | null {
  const raw = gateway.readMessageExtra(id, FRAME_FIELD_PREFIX)
  if (typeof raw !== 'string') return null
  return JSON.parse(raw) as StorageFrame
}

function sqlOp(sql: string, reason: SqlBatchOperation['reason'] = 'ai_fill'): MutationOperation {
  return { kind: 'sql_batch', statements: [sql], reason }
}

const OPTS = { strategy: 'every-message' as const, interval: 20, retainFloors: 100 }

describe('新存储模型 persistFill', () => {
  it('首次持久化只写 init 全量 checkpoint，不追加增量（防重载翻倍）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    core.run("INSERT INTO t VALUES ('seed')")
    const { gateway } = makeChatGateway(5)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], OPTS)
    const frame = loadFrame(gateway, 1)
    expect(frame?.checkpoint?.reason).toBe('init')
    expect(frame?.checkpoint?.data.tables[0]?.rows).toHaveLength(1)
    expect(frame?.logEntries).toHaveLength(0)
    core.dispose()
  })

  it('首次持久化后重载行数不翻倍（端到端）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const { gateway } = makeChatGateway(5)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    core.run("INSERT INTO t VALUES ('a')")
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], OPTS)
    const core2 = new SqliteCore()
    await core2.init()
    core2.run('CREATE TABLE t (c TEXT)')
    const bridge2 = new SqliteSyncBridge(core2, gateway)
    const result = bridge2.load()
    expect(result.ok).toBe(true)
    const rows = core2.exec('SELECT * FROM t')
    expect(rows[0]!.rows).toHaveLength(1)
    core.dispose()
    core2.dispose()
  })

  it('后续楼层只追加增量，不写全量 checkpoint', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const { gateway } = makeChatGateway(6)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], OPTS)
    persistFill(ctx, 3, [sqlOp("INSERT INTO t VALUES ('b')")], OPTS)
    const frame1 = loadFrame(gateway, 1)
    const frame3 = loadFrame(gateway, 3)
    expect(frame1?.checkpoint?.reason).toBe('init')
    expect(frame3?.checkpoint).toBeUndefined()
    expect(frame3?.logEntries).toHaveLength(1)
    core.dispose()
  })

  it('定期 checkpoint：楼层差超 interval 时写 periodic 全量', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const { gateway } = makeChatGateway(10)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    const opts = { strategy: 'every-message' as const, interval: 5, retainFloors: 100 }
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], opts)
    persistFill(ctx, 3, [sqlOp("INSERT INTO t VALUES ('b')")], opts)
    expect(loadFrame(gateway, 3)?.checkpoint).toBeUndefined()
    persistFill(ctx, 7, [sqlOp("INSERT INTO t VALUES ('c')")], opts)
    expect(loadFrame(gateway, 7)?.checkpoint?.reason).toBe('periodic')
    core.dispose()
  })

  it('latest-only：每次清空只留最新全量', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const { gateway } = makeChatGateway(6)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    const opts = { strategy: 'latest-only' as const, interval: 20, retainFloors: 100 }
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], opts)
    persistFill(ctx, 3, [sqlOp("INSERT INTO t VALUES ('b')")], opts)
    expect(loadFrame(gateway, 1)).toBeNull()
    expect(loadFrame(gateway, 3)?.checkpoint?.reason).toBe('manual')
    expect(loadFrame(gateway, 3)?.logEntries).toHaveLength(0)
    core.dispose()
  })

  it('跨帧相同 SQL 不去重', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const { gateway } = makeChatGateway(8)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    persistFill(ctx, 1, [], OPTS)
    core.run("INSERT INTO t VALUES ('x')")
    persistFill(ctx, 3, [sqlOp("INSERT INTO t VALUES ('x')")], OPTS)
    core.run("INSERT INTO t VALUES ('x')")
    persistFill(ctx, 5, [sqlOp("INSERT INTO t VALUES ('x')")], OPTS)
    const core2 = new SqliteCore()
    await core2.init()
    core2.run('CREATE TABLE t (c TEXT)')
    const bridge2 = new SqliteSyncBridge(core2, gateway)
    const result = bridge2.load()
    expect(result.ok).toBe(true)
    const rows = core2.exec('SELECT * FROM t')
    expect(rows[0]!.rows).toHaveLength(2)
    core.dispose()
    core2.dispose()
  })

  it('同帧相同 SQL 去重只执行一次', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const { gateway } = makeChatGateway(6)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    persistFill(ctx, 1, [], OPTS)
    core.run("INSERT INTO t VALUES ('x')")
    persistFill(ctx, 3, [
      sqlOp("INSERT INTO t VALUES ('x')", 'ai_fill_table'),
      sqlOp("INSERT INTO t VALUES ('x')", 'ai_fill_chronicle'),
    ], OPTS)
    const core2 = new SqliteCore()
    await core2.init()
    core2.run('CREATE TABLE t (c TEXT)')
    const bridge2 = new SqliteSyncBridge(core2, gateway)
    bridge2.load()
    const rows = core2.exec('SELECT * FROM t')
    expect(rows[0]!.rows).toHaveLength(1)
    core.dispose()
    core2.dispose()
  })

  it('retainRecentFrames：保留区无 checkpoint 时不删（不丢基线）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const { gateway } = makeChatGateway(10)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    const opts = { strategy: 'every-message' as const, interval: 100, retainFloors: 100 }
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], opts)
    persistFill(ctx, 3, [sqlOp("INSERT INTO t VALUES ('b')")], opts)
    persistFill(ctx, 5, [sqlOp("INSERT INTO t VALUES ('c')")], opts)
    retainRecentFrames(ctx, 2)
    expect(loadFrame(gateway, 1)).not.toBeNull()
    core.dispose()
  })

  it('retainRecentFrames：保留区有 checkpoint 时删更老', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const { gateway } = makeChatGateway(10)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    const opts = { strategy: 'every-message' as const, interval: 3, retainFloors: 100 }
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], opts)
    persistFill(ctx, 5, [sqlOp("INSERT INTO t VALUES ('b')")], opts)
    persistFill(ctx, 7, [sqlOp("INSERT INTO t VALUES ('c')")], opts)
    expect(loadFrame(gateway, 5)?.checkpoint?.reason).toBe('periodic')
    retainRecentFrames(ctx, 2)
    expect(loadFrame(gateway, 1)).toBeNull()
    expect(loadFrame(gateway, 5)).not.toBeNull()
    core.dispose()
  })
})
