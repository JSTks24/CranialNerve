import { describe, expect, it } from 'vitest'
import SqliteCore from '../src/db/sqlite/core'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
import { FRAME_FIELD_PREFIX } from '../src/shared/constants/msg-fields'
import type { ChatGateway } from '../src/db/gateways/chat'
import type { StorageFrame } from '../src/shared/types/storage-frame'
import type { DatabaseSnapshot } from '../src/shared/types/table'

function makeSnapshot(cellValue: string): DatabaseSnapshot {
  return {
    tables: [{
      name: 't',
      columns: [{ name: 'c', displayName: 'c', type: 'TEXT' }],
      rows: [{ c: cellValue }],
    }],
  }
}

function makeFrame(cellValue: string): StorageFrame {
  return {
    version: 2,
    logEntries: [],
    checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: makeSnapshot(cellValue) },
  }
}

interface FakeMessage {
  is_user: boolean
  mes: string
  extra: Record<string, unknown>
}

function makeChatGateway(frames: Record<number, string>): { gateway: ChatGateway; chat: FakeMessage[] } {
  const chat: FakeMessage[] = [
    { is_user: true, mes: 'hi', extra: {} },
    { is_user: false, mes: 'ai1', extra: frames[1] ? { [FRAME_FIELD_PREFIX]: frames[1] } : {} },
    { is_user: false, mes: 'ai2', extra: frames[2] ? { [FRAME_FIELD_PREFIX]: frames[2] } : {} },
  ]
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

function makeFrameNoCheckpoint(): StorageFrame {
  return { version: 2, logEntries: [] }
}

describe('sync-bridge load 真实 replay（含 applySnapshot）', () => {
  it('末层 frame 存在时 load 灌入末层 checkpoint', async () => {
    const core = new SqliteCore()
    await core.init()
    const { gateway } = makeChatGateway({
      1: JSON.stringify(makeFrame('A')),
      2: JSON.stringify(makeFrame('B')),
    })
    const bridge = new SqliteSyncBridge(core, gateway)
    const result = bridge.load()
    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows[0]!.c).toBe('B')
    core.dispose()
  })

  it('removeFrame 末层后 load 回退到上一层 checkpoint', async () => {
    const core = new SqliteCore()
    await core.init()
    const { gateway } = makeChatGateway({
      1: JSON.stringify(makeFrame('A')),
      2: JSON.stringify(makeFrame('B')),
    })
    const bridge = new SqliteSyncBridge(core, gateway)
    bridge.getRepo().removeFrame(2)
    const result = bridge.load()
    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows[0]!.c).toBe('A')
    core.dispose()
  })

  it('末层 frame 带增量 log 时 load 回放 SQL', async () => {
    const core = new SqliteCore()
    await core.init()
    const frame: StorageFrame = {
      version: 2,
      logEntries: [{
        seq: 1,
        createdAt: 0,
        operations: [{ kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('C')"], reason: 'ai_fill' }],
      }],
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: makeSnapshot('A') },
    }
    const { gateway } = makeChatGateway({ 1: JSON.stringify(frame) })
    const bridge = new SqliteSyncBridge(core, gateway)
    const result = bridge.load()
    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t ORDER BY c')
    expect(rows[0]!.rows).toHaveLength(2)
    expect(rows[0]!.rows[0]!.c).toBe('A')
    expect(rows[0]!.rows[1]!.c).toBe('C')
    core.dispose()
  })

  it('同帧相同 SQL 双 reason 同帧去重只执行一次', async () => {
    const core = new SqliteCore()
    await core.init()
    const frame: StorageFrame = {
      version: 2,
      logEntries: [{
        seq: 1,
        createdAt: 0,
        operations: [
          { kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('C')"], reason: 'ai_fill_table' },
          { kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('C')"], reason: 'ai_fill_chronicle' },
        ],
      }],
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: makeSnapshot('A') },
    }
    const { gateway } = makeChatGateway({ 1: JSON.stringify(frame) })
    const bridge = new SqliteSyncBridge(core, gateway)
    const result = bridge.load()
    expect(result.ok).toBe(true)
    expect(result.warnings).toHaveLength(0)
    const rows = core.exec('SELECT * FROM t ORDER BY c')
    expect(rows[0]!.rows).toHaveLength(2)
    expect(rows[0]!.rows[0]!.c).toBe('A')
    expect(rows[0]!.rows[1]!.c).toBe('C')
    core.dispose()
  })

  it('多楼层各自帧回放全部执行（逐层落帧场景）', async () => {
    const core = new SqliteCore()
    await core.init()
    const frame1: StorageFrame = {
      version: 2,
      logEntries: [{
        seq: 1,
        createdAt: 0,
        operations: [{ kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('B')"], reason: 'ai_fill_table' }],
      }],
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: makeSnapshot('A') },
    }
    const frame2: StorageFrame = {
      version: 2,
      logEntries: [{
        seq: 1,
        createdAt: 0,
        operations: [{ kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('C')"], reason: 'ai_fill_table' }],
      }],
    }
    const { gateway } = makeChatGateway({ 1: JSON.stringify(frame1), 2: JSON.stringify(frame2) })
    const bridge = new SqliteSyncBridge(core, gateway)
    const result = bridge.load()
    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t ORDER BY c')
    expect(rows[0]!.rows).toHaveLength(3)
    expect(rows[0]!.rows.map((r) => r.c)).toEqual(['A', 'B', 'C'])
    core.dispose()
  })

  it('同帧不同 SQL 双 op 回放全部执行', async () => {
    const core = new SqliteCore()
    await core.init()
    const frame: StorageFrame = {
      version: 2,
      logEntries: [{
        seq: 1,
        createdAt: 0,
        operations: [
          { kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('B')"], reason: 'ai_fill_table' },
          { kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('C')"], reason: 'ai_fill_chronicle' },
        ],
      }],
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: makeSnapshot('A') },
    }
    const { gateway } = makeChatGateway({ 1: JSON.stringify(frame) })
    const bridge = new SqliteSyncBridge(core, gateway)
    const result = bridge.load()
    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t ORDER BY c')
    expect(rows[0]!.rows).toHaveLength(3)
    expect(rows[0]!.rows.map((r) => r.c)).toEqual(['A', 'B', 'C'])
    core.dispose()
  })

  it('有帧无 checkpoint 时 load 返回 ok:false 且警告含「无 checkpoint」', async () => {
    const core = new SqliteCore()
    await core.init()
    const { gateway } = makeChatGateway({ 2: JSON.stringify(makeFrameNoCheckpoint()) })
    const bridge = new SqliteSyncBridge(core, gateway)
    const result = bridge.load()
    expect(result.ok).toBe(false)
    expect(result.warnings.join('; ')).toContain('无 checkpoint')
    core.dispose()
  })

  it('帧 JSON 损坏时 load 警告含「帧数据损坏」', async () => {
    const core = new SqliteCore()
    await core.init()
    const { gateway, chat } = makeChatGateway({})
    chat[1]!.extra = { [FRAME_FIELD_PREFIX]: '{broken json' }
    const bridge = new SqliteSyncBridge(core, gateway)
    const result = bridge.load()
    expect(result.warnings.join('; ')).toContain('帧数据损坏')
    expect(result.warnings.join('; ')).toContain('第 2 楼')
    core.dispose()
  })

  it('回放 SQL 失败时 lastLoadWarnings 含「回放 SQL 失败」关键告警（1.4 修复）', async () => {
    const core = new SqliteCore()
    await core.init()
    const frame: StorageFrame = {
      version: 2,
      logEntries: [{
        seq: 1,
        createdAt: 0,
        operations: [{ kind: 'sql_batch', statements: ["INSERT INTO missing_table VALUES ('X')"], reason: 'ai_fill' }],
      }],
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: makeSnapshot('A') },
    }
    const { gateway } = makeChatGateway({ 1: JSON.stringify(frame) })
    const bridge = new SqliteSyncBridge(core, gateway)
    const result = bridge.load()
    expect(result.ok).toBe(true)
    expect(bridge.lastLoadWarnings.join('; ')).toContain('回放 SQL 失败 1 条')
    core.dispose()
  })

  it('回放全部成功时不产生「回放 SQL 失败」告警', async () => {
    const core = new SqliteCore()
    await core.init()
    const frame: StorageFrame = {
      version: 2,
      logEntries: [{
        seq: 1,
        createdAt: 0,
        operations: [{ kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('C')"], reason: 'ai_fill' }],
      }],
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: makeSnapshot('A') },
    }
    const { gateway } = makeChatGateway({ 1: JSON.stringify(frame) })
    const bridge = new SqliteSyncBridge(core, gateway)
    const result = bridge.load()
    expect(result.ok).toBe(true)
    expect(bridge.lastLoadWarnings.join('; ')).not.toContain('回放 SQL 失败')
    core.dispose()
  })

  it('回放中途失败时整体回滚到快照（3.5 修复：不再部分生效）', async () => {
    const core = new SqliteCore()
    await core.init()
    const frame: StorageFrame = {
      version: 2,
      logEntries: [{
        seq: 1,
        createdAt: 0,
        operations: [
          { kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('B')"], reason: 'ai_fill' },
          { kind: 'sql_batch', statements: ["INSERT INTO missing_table VALUES ('X')"], reason: 'ai_fill' },
        ],
      }],
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: makeSnapshot('A') },
    }
    const { gateway } = makeChatGateway({ 1: JSON.stringify(frame) })
    const bridge = new SqliteSyncBridge(core, gateway)
    const result = bridge.load()
    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t ORDER BY c')
    expect(rows[0]!.rows).toHaveLength(1)
    expect(rows[0]!.rows[0]!.c).toBe('A')
    expect(bridge.lastLoadWarnings.join('; ')).toContain('回放 SQL 失败')
    core.dispose()
  })
})
