import { describe, expect, it } from 'vitest'
import SqliteCore from '../src/db/sqlite/core'
import createFrameRepo from '../src/db/sqlite/storage-frame-repo'
import { createPersistContext } from '../src/db/sqlite/frame-persist'
import executeTableEditSql, { rewriteChronicleInsert } from '../src/core/table/sql-executor'
import { SQL_EDIT_FORMAT } from '../src/shared/constants/sql-json'
import type { ChatGateway } from '../src/db/gateways/chat'
import type { TableEditSqlV1 } from '../src/shared/types/ai'

function makeChatGateway(writeMessageExtra: (id: number, key: string, value: unknown) => void) {
  const chat: Array<{ is_user: boolean; mes: string; extra: Record<string, unknown> }> = [
    { is_user: true, mes: 'u', extra: {} },
    { is_user: false, mes: 'a', extra: {} },
  ]
  return {
    getChat: () => chat,
    getLastUserMessageId: () => null,
    appendKeywordsToMessage: () => {},
    readChatMetadata: () => undefined,
    writeChatMetadata: () => {},
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra,
    saveChat: async () => {},
  } as unknown as ChatGateway
}

describe('executeTableEditSql 落帧失败处理（1.5 修复：SQL 已执行但落帧失败不再静默丢失）', () => {
  it('落帧失败且补写 checkpoint 也失败时返回 ok:false + infrastructure', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const gateway = makeChatGateway(() => { throw new Error('storage failed') })
    const repo = createFrameRepo(gateway)
    const ctx = createPersistContext(repo, core)
    const edits: TableEditSqlV1[] = [{ format: SQL_EDIT_FORMAT, sql: "INSERT INTO t VALUES ('X')" }]
    const result = executeTableEditSql(core, edits, { ctx, messageId: 1 })
    expect(result.ok).toBe(false)
    expect(result.errorCategory).toBe('infrastructure')
    expect(result.error).toContain('落帧失败')
    core.dispose()
  })

  it('落帧正常时返回 ok:true 且 SQL 已执行', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const gateway = makeChatGateway(() => {})
    const repo = createFrameRepo(gateway)
    const ctx = createPersistContext(repo, core)
    const edits: TableEditSqlV1[] = [{ format: SQL_EDIT_FORMAT, sql: "INSERT INTO t VALUES ('X')" }]
    const result = executeTableEditSql(core, edits, { ctx, messageId: 1 })
    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows[0]!.c).toBe('X')
    core.dispose()
  })

  it('无 persist 参数时执行 SQL 并返回 ok:true（手动编辑路径）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const edits: TableEditSqlV1[] = [{ format: SQL_EDIT_FORMAT, sql: "INSERT INTO t VALUES ('Y')" }]
    const result = executeTableEditSql(core, edits)
    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows[0]!.c).toBe('Y')
    core.dispose()
  })

  it('DROP TABLE 被白名单拒绝且表保留（3.4 修复）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    const gateway = makeChatGateway(() => {})
    const repo = createFrameRepo(gateway)
    const ctx = createPersistContext(repo, core)
    const edits: TableEditSqlV1[] = [{ format: SQL_EDIT_FORMAT, sql: 'DROP TABLE t' }]
    const result = executeTableEditSql(core, edits, { ctx, messageId: 1 })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不允许的语句类型')
    expect(core.listTables()).toContain('t')
    core.dispose()
  })

  it('CREATE/ALTER 被白名单拒绝', async () => {
    const core = new SqliteCore()
    await core.init()
    const gateway = makeChatGateway(() => {})
    const repo = createFrameRepo(gateway)
    const ctx = createPersistContext(repo, core)
    const edits: TableEditSqlV1[] = [{ format: SQL_EDIT_FORMAT, sql: 'CREATE TABLE evil (x TEXT)' }]
    const result = executeTableEditSql(core, edits, { ctx, messageId: 1 })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不允许的语句类型')
    expect(core.listTables()).not.toContain('evil')
    core.dispose()
  })

  it('INSERT OR REPLACE INTO 被允许执行（含替换语义）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)')
    core.run("INSERT INTO t VALUES ('1', 'old')")
    const gateway = makeChatGateway(() => {})
    const repo = createFrameRepo(gateway)
    const ctx = createPersistContext(repo, core)
    const edits: TableEditSqlV1[] = [{ format: SQL_EDIT_FORMAT, sql: "INSERT OR REPLACE INTO t VALUES ('1', 'new')" }]
    const result = executeTableEditSql(core, edits, { ctx, messageId: 1 })
    expect(result.ok).toBe(true)
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows).toHaveLength(1)
    expect(rows[0]!.rows[0]!.v).toBe('new')
    core.dispose()
  })
})

describe('rewriteChronicleInsert 楼层 key 改写', () => {
  it('单行 VALUES 改写为 REPLACE 与楼层 key', () => {
    const sql = "INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0099', '剧情')"
    const r = rewriteChronicleInsert(sql, 5)
    expect(r).toContain('REPLACE INTO cn_chronicle')
    expect(r).toContain("'CN0005'")
    expect(r).toContain('剧情')
  })

  it('多行 VALUES 无法安全改写时返回 null（原 SQL 走兜底）', () => {
    const sql = "INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0099', '第一行'), ('CN0100', '第二行')"
    expect(rewriteChronicleInsert(sql, 5)).toBeNull()
  })

  it('缺 key 列的 INSERT 不改写返回 null', () => {
    const sql = "INSERT INTO cn_chronicle (chronicle_text) VALUES ('剧情')"
    expect(rewriteChronicleInsert(sql, 5)).toBeNull()
  })

  it('非 cn_chronicle 语句不改写返回 null', () => {
    const sql = "UPDATE hero SET hp = 50 WHERE name = '勇者'"
    expect(rewriteChronicleInsert(sql, 5)).toBeNull()
  })
})
