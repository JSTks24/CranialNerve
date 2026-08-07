import { describe, expect, it } from 'vitest'
import SqliteCore from '../src/db/sqlite/core'
import { analyzeMigration, migrateCommonData } from '../src/core/template-migrate'
import type { CardTemplate } from '../src/shared/types/card'
import type { DatabaseSnapshot } from '../src/shared/types/table'

function tmpl(tables: Array<{ name: string; columns: Array<{ name: string; type: string }> }>): CardTemplate {
  return {
    templateVersion: 1,
    tables: tables.map((t) => ({
      name: t.name,
      displayName: t.name,
      columns: t.columns.map((c) => ({ name: c.name, displayName: c.name, type: c.type }))
    }))
  }
}

function snap(tables: Array<{ name: string; columns: Array<{ name: string; type: string }>; rows: Array<Record<string, string | number | null>> }>): DatabaseSnapshot {
  return {
    tables: tables.map((t) => ({
      name: t.name,
      columns: t.columns.map((c) => ({ name: c.name, displayName: c.name, type: c.type })),
      rows: t.rows
    }))
  }
}

describe('analyzeMigration', () => {
  it('完全兼容：只加列', () => {
    const oldT = tmpl([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }] }])
    const newT = tmpl([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }, { name: 'b', type: 'TEXT' }] }])
    const diff = analyzeMigration(oldT, newT, snap([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }], rows: [{ a: 'x' }] }]))
    expect(diff.compatible).toBe(true)
    expect(diff.incompatible).toHaveLength(0)
    expect(diff.migratedTables[0]?.commonCols).toEqual(['a'])
  })

  it('不兼容：删列', () => {
    const oldT = tmpl([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }, { name: 'b', type: 'TEXT' }] }])
    const newT = tmpl([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }] }])
    const diff = analyzeMigration(oldT, newT, snap([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }, { name: 'b', type: 'TEXT' }], rows: [{ a: 'x', b: 'y' }] }]))
    expect(diff.compatible).toBe(false)
    expect(diff.incompatible[0]?.cols).toEqual(['b'])
  })

  it('不兼容：删整表', () => {
    const oldT = tmpl([{ name: 't1', columns: [{ name: 'a', type: 'TEXT' }] }, { name: 't2', columns: [{ name: 'a', type: 'TEXT' }] }])
    const newT = tmpl([{ name: 't1', columns: [{ name: 'a', type: 'TEXT' }] }])
    const diff = analyzeMigration(oldT, newT, snap([
      { name: 't1', columns: [{ name: 'a', type: 'TEXT' }], rows: [{ a: 'x' }] },
      { name: 't2', columns: [{ name: 'a', type: 'TEXT' }], rows: [{ a: 'y' }] }
    ]))
    expect(diff.compatible).toBe(false)
    expect(diff.removedTables).toEqual(['t2'])
  })

  it('无旧模板视为兼容', () => {
    const newT = tmpl([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }] }])
    const diff = analyzeMigration(null, newT, { tables: [] })
    expect(diff.compatible).toBe(true)
  })
})

describe('migrateCommonData', () => {
  it('共有列迁移，目标缺列则跳过该列', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (a TEXT)')
    const oldSnap = snap([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }, { name: 'b', type: 'TEXT' }], rows: [{ a: '1', b: '2' }, { a: '3', b: '4' }] }])
    const newT = tmpl([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }] }])
    const n = migrateCommonData(core, oldSnap, newT)
    expect(n).toBe(2)
    const rows = core.exec('SELECT a FROM t ORDER BY a')
    expect(rows[0]!.rows).toHaveLength(2)
    core.dispose()
  })

  it('目标新增列留空，旧行共有列保留', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (a TEXT, b TEXT)')
    const oldSnap = snap([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }], rows: [{ a: 'x' }] }])
    const newT = tmpl([{ name: 't', columns: [{ name: 'a', type: 'TEXT' }, { name: 'b', type: 'TEXT' }] }])
    migrateCommonData(core, oldSnap, newT)
    const rows = core.exec('SELECT a, b FROM t')
    expect(rows[0]!.rows[0]!.a).toBe('x')
    expect(rows[0]!.rows[0]!.b).toBeNull()
    core.dispose()
  })

  it('无旧数据不迁', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t2 (a TEXT)')
    const newT = tmpl([{ name: 't2', columns: [{ name: 'a', type: 'TEXT' }] }])
    const n = migrateCommonData(core, { tables: [] }, newT)
    expect(n).toBe(0)
    core.dispose()
  })
})
