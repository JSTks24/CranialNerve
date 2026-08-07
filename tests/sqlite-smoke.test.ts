import { describe, expect, it } from 'vitest'
import SqliteCore from '../src/db/sqlite/core'

describe('SqliteCore smoke', () => {
  it('init + run + exec 真实跑通', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    core.run('INSERT INTO t VALUES (?)', ['hello'])
    const result = core.exec('SELECT * FROM t')
    expect(result[0]!.rows[0]!.c).toBe('hello')
    core.dispose()
  })

  it('带参多语句抛错而非静默截断（修复③：统一 run 语义）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    expect(() => core.run('INSERT INTO t VALUES (?); INSERT INTO t VALUES (?)', ['a', 'b']))
      .toThrow('不支持多语句')
    core.dispose()
  })

  it('带参单语句正常执行', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    expect(() => core.run('INSERT INTO t VALUES (?)', ['a'])).not.toThrow()
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows).toHaveLength(1)
    core.dispose()
  })

  it('无参多语句正常执行（exec 语义）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    expect(() => core.run('INSERT INTO t VALUES (\'a\'); INSERT INTO t VALUES (\'b\')')).not.toThrow()
    const rows = core.exec('SELECT * FROM t')
    expect(rows[0]!.rows).toHaveLength(2)
    core.dispose()
  })

  it('带参 SQL 值内分号不误判为多语句', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (c TEXT)')
    expect(() => core.run("INSERT INTO t VALUES ('a;b')")).not.toThrow()
    core.dispose()
  })
})
