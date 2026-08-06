import { describe, expect, it } from 'vitest'
import SqliteCore from '../src/db/sqlite/core'
import createFrameRepo from '../src/db/sqlite/storage-frame-repo'
import { createPersistContext, appendSqlLog, writeCheckpoint } from '../src/db/sqlite/frame-persist'
import type { ChatGateway } from '../src/db/gateways/chat'
import type { StorageFrame } from '../src/shared/types/storage-frame'

function makeRepo() {
  const chat: { extra: Record<string, unknown> }[] = [{ extra: {} }, { extra: {} }]
  const gateway = {
    getChat: () => chat,
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      const msg = chat[id]
      if (!msg) return
      msg.extra[key] = value
    },
    saveChat: async () => {},
  } as unknown as ChatGateway
  return createFrameRepo(gateway)
}

describe('frame-persist summarizedReasons（手动 checkpoint 后 ai_fill 元信息不丢）', () => {
  it('appendSqlLog 把 ai_fill reason 累积进 summarizedReasons', async () => {
    const core = new SqliteCore()
    await core.init()
    const repo = makeRepo()
    const ctx = createPersistContext(repo, core)
    appendSqlLog(ctx, 1, [
      { kind: 'sql_batch', statements: ['INSERT INTO t VALUES (1)'], reason: 'ai_fill_table' },
      { kind: 'sql_batch', statements: ['INSERT INTO cn_chronicle VALUES (1)'], reason: 'ai_fill_chronicle' },
    ])
    const frame = repo.loadFrame(1)
    expect(frame?.summarizedReasons).toEqual(['ai_fill_table', 'ai_fill_chronicle'])
    core.dispose()
  })

  it('manual_edit 等非 ai_fill reason 不累积', async () => {
    const core = new SqliteCore()
    await core.init()
    const repo = makeRepo()
    const ctx = createPersistContext(repo, core)
    appendSqlLog(ctx, 1, [
      { kind: 'sql_batch', statements: ['UPDATE t SET c = 1'], reason: 'manual_edit' },
    ])
    const frame = repo.loadFrame(1)
    expect(frame?.summarizedReasons).toBeUndefined()
    core.dispose()
  })

  it('writeCheckpoint 清空 logEntries 但保留 summarizedReasons', async () => {
    const core = new SqliteCore()
    await core.init()
    const repo = makeRepo()
    const ctx = createPersistContext(repo, core)
    appendSqlLog(ctx, 1, [
      { kind: 'sql_batch', statements: ['INSERT INTO t VALUES (1)'], reason: 'ai_fill_table' },
    ])
    writeCheckpoint(ctx, 1, 'manual')
    const frame = repo.loadFrame(1)
    expect(frame?.logEntries).toHaveLength(0)
    expect(frame?.summarizedReasons).toEqual(['ai_fill_table'])
    core.dispose()
  })

  it('writeCheckpoint 后新的 ai_fill reason 继续合并', async () => {
    const core = new SqliteCore()
    await core.init()
    const repo = makeRepo()
    const ctx = createPersistContext(repo, core)
    appendSqlLog(ctx, 1, [
      { kind: 'sql_batch', statements: ['INSERT INTO t VALUES (1)'], reason: 'ai_fill_table' },
    ])
    writeCheckpoint(ctx, 1, 'manual')
    appendSqlLog(ctx, 1, [
      { kind: 'sql_batch', statements: ['INSERT INTO cn_chronicle VALUES (1)'], reason: 'ai_fill_chronicle' },
    ])
    const frame = repo.loadFrame(1)
    expect(frame?.summarizedReasons).toEqual(['ai_fill_table', 'ai_fill_chronicle'])
    core.dispose()
  })

  it('writeCheckpoint 快照是拍摄时刻的数据库状态（含已有数据）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    core.run("INSERT INTO t VALUES ('old')")
    const repo = makeRepo()
    const ctx = createPersistContext(repo, core)
    appendSqlLog(ctx, 1, [
      { kind: 'sql_batch', statements: ["INSERT INTO t VALUES ('x')"], reason: 'ai_fill_table' },
    ])
    writeCheckpoint(ctx, 1, 'manual')
    const frame = repo.loadFrame(1) as StorageFrame
    expect(frame.checkpoint!.data.tables[0]!.rows).toEqual([{ c: 'old' }])
    core.dispose()
  })
})
