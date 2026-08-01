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
})
