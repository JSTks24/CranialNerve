import { describe, expect, it } from 'vitest'
import SqliteCore from '../src/db/sqlite/core'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
import { persistFill, createPersistContext, writeBucketCheckpoint, retainRecentFrames } from '../src/db/sqlite/frame-persist'
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

const OPTS = { strategy: 'every-message' as const, retainFloors: 100 }

describe('新存储模型 persistFill + writeBucketCheckpoint', () => {
  it('persistFill 只追加增量；writeBucketCheckpoint 才写 init 全量（快照=当前 DB，清该楼 logEntries）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    core.run("INSERT INTO t VALUES ('seed')")
    const { gateway } = makeChatGateway(5)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], OPTS)
    core.run("INSERT INTO t VALUES ('a')")
    const frameLog = loadFrame(gateway, 1)
    expect(frameLog?.checkpoint).toBeUndefined()
    expect(frameLog?.logEntries).toHaveLength(1)
    writeBucketCheckpoint(ctx, 1, { interval: 20 })
    const frameCp = loadFrame(gateway, 1)
    expect(frameCp?.checkpoint?.reason).toBe('init')
    expect(frameCp?.checkpoint?.data.tables[0]?.rows).toHaveLength(2)
    expect(frameCp?.logEntries).toHaveLength(0)
    core.dispose()
  })

  it('bucket 边界 checkpoint 后重载行数不翻倍（端到端）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const { gateway } = makeChatGateway(5)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    core.run("INSERT INTO t VALUES ('a')")
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], OPTS)
    writeBucketCheckpoint(ctx, 1, { interval: 20 })
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
    writeBucketCheckpoint(ctx, 1, { interval: 20 })
    persistFill(ctx, 3, [sqlOp("INSERT INTO t VALUES ('b')")], OPTS)
    persistFill(ctx, 5, [sqlOp("INSERT INTO t VALUES ('c')")], OPTS)
    const frame1 = loadFrame(gateway, 1)
    const frame3 = loadFrame(gateway, 3)
    expect(frame1?.checkpoint?.reason).toBe('init')
    expect(frame3?.checkpoint).toBeUndefined()
    expect(frame3?.logEntries).toHaveLength(1)
    core.dispose()
  })

  it('定期 checkpoint：bucket 边界楼层差超 interval 时写 periodic 全量', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const { gateway } = makeChatGateway(10)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)
    writeBucketCheckpoint(ctx, 1, { interval: 5 })
    persistFill(ctx, 3, [sqlOp("INSERT INTO t VALUES ('b')")], OPTS)
    expect(loadFrame(gateway, 3)?.checkpoint).toBeUndefined()
    writeBucketCheckpoint(ctx, 7, { interval: 5 })
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
    const opts = { strategy: 'latest-only' as const, retainFloors: 100 }
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
    writeBucketCheckpoint(ctx, 1, { interval: 20 })
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
    writeBucketCheckpoint(ctx, 1, { interval: 20 })
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
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], OPTS)
    persistFill(ctx, 3, [sqlOp("INSERT INTO t VALUES ('b')")], OPTS)
    persistFill(ctx, 5, [sqlOp("INSERT INTO t VALUES ('c')")], OPTS)
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
    persistFill(ctx, 1, [sqlOp("INSERT INTO t VALUES ('a')")], OPTS)
    writeBucketCheckpoint(ctx, 1, { interval: 3 })
    persistFill(ctx, 5, [sqlOp("INSERT INTO t VALUES ('b')")], OPTS)
    writeBucketCheckpoint(ctx, 5, { interval: 3 })
    persistFill(ctx, 7, [sqlOp("INSERT INTO t VALUES ('c')")], OPTS)
    writeBucketCheckpoint(ctx, 7, { interval: 3 })
    expect(loadFrame(gateway, 5)?.checkpoint?.reason).toBe('periodic')
    retainRecentFrames(ctx, 2)
    expect(loadFrame(gateway, 1)).toBeNull()
    expect(loadFrame(gateway, 5)).not.toBeNull()
    core.dispose()
  })
})

describe('bucket 边界 checkpoint：多桶回放不翻倍、不丢后续桶（追平刷新丢数据回归）', () => {
  it('两桶逐层落帧 + 桶末 checkpoint，重载后每表行数唯一、两桶数据齐全', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (k TEXT PRIMARY KEY, c TEXT)')
    core.run('CREATE TABLE cn_chronicle (key TEXT PRIMARY KEY, chronicle_text TEXT)')
    const { gateway } = makeChatGateway(12)
    const bridge = new SqliteSyncBridge(core, gateway)
    const ctx = createPersistContext(bridge.getRepo(), core)

    const bucketApply = (floors: number[]) => {
      for (const f of floors) {
        core.run("INSERT INTO t (k, c) VALUES ('k" + f + "', 'v" + f + "')")
        persistFill(ctx, f, [sqlOp("INSERT INTO t (k, c) VALUES ('k" + f + "', 'v" + f + "')")], OPTS)
        core.run("INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN" + String(f).padStart(4, '0') + "', 'x" + f + "')")
        persistFill(ctx, f, [sqlOp("INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN" + String(f).padStart(4, '0') + "', 'x" + f + "')", 'ai_fill_chronicle')], OPTS)
      }
      writeBucketCheckpoint(ctx, floors[floors.length - 1]!, { interval: 20 })
    }

    bucketApply([1, 3])
    bucketApply([5, 7])

    const core2 = new SqliteCore()
    await core2.init()
    core2.run('CREATE TABLE t (k TEXT PRIMARY KEY, c TEXT)')
    core2.run('CREATE TABLE cn_chronicle (key TEXT PRIMARY KEY, chronicle_text TEXT)')
    const bridge2 = new SqliteSyncBridge(core2, gateway)
    const result = bridge2.load()
    expect(result.ok).toBe(true)

    const tRows = core2.exec('SELECT k FROM t')[0]?.rows ?? []
    const cRows = core2.exec('SELECT key FROM cn_chronicle')[0]?.rows ?? []
    expect(tRows).toHaveLength(4)
    expect(cRows).toHaveLength(4)
    const tKeys = new Set(tRows.map((r) => r['k']))
    const cKeys = new Set(cRows.map((r) => r['key']))
    expect(tKeys).toEqual(new Set(['k1', 'k3', 'k5', 'k7']))
    expect(cKeys).toEqual(new Set(['CN0001', 'CN0003', 'CN0005', 'CN0007']))
    core.dispose()
    core2.dispose()
  })
})
