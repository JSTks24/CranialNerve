import { describe, expect, it } from 'vitest'
import { buildCreateTableSql } from '@shared/template-builder'
import type { ColumnDef } from '@shared/types/table'

function col(partial: Partial<ColumnDef> & Pick<ColumnDef, 'name'>): ColumnDef {
  return { displayName: partial.name, type: 'TEXT', ...partial }
}

describe('buildCreateTableSql', () => {
  it('空列表抛明确错误', () => {
    expect(() => buildCreateTableSql({ name: 't', columns: [] })).toThrow('没有列')
  })

  it('defaultValue 空字符串不加 DEFAULT 子句', () => {
    const sql = buildCreateTableSql({
      name: 't',
      columns: [col({ name: 'c', constraints: { defaultValue: '' } })]
    })
    expect(sql).not.toContain('DEFAULT')
  })

  it('defaultValue 非空仍保留 DEFAULT', () => {
    const sql = buildCreateTableSql({
      name: 't',
      columns: [col({ name: 'c', constraints: { defaultValue: '0' } })]
    })
    expect(sql).toContain('DEFAULT 0')
  })

  it('defaultValue 字符串字面量含括号被加单引号', () => {
    const sql = buildCreateTableSql({
      name: 't',
      columns: [col({ name: 'c', constraints: { defaultValue: 'foo(bar)' } })]
    })
    expect(sql).toContain("DEFAULT 'foo(bar)'")
    expect(sql).not.toMatch(/DEFAULT foo\(bar\)/)
  })

  it('defaultValue 已含单引号原样保留', () => {
    const sql = buildCreateTableSql({
      name: 't',
      columns: [col({ name: 'c', constraints: { defaultValue: "'foo'" } })]
    })
    expect(sql).toContain("DEFAULT 'foo'")
  })

  it('defaultValue 数字直接拼接不加引号', () => {
    const sql = buildCreateTableSql({
      name: 't',
      columns: [col({ name: 'c', constraints: { defaultValue: '42' } })]
    })
    expect(sql).toContain('DEFAULT 42')
    expect(sql).not.toContain("DEFAULT '42'")
  })

  it('defaultValue CURRENT_TIMESTAMP 等常量直接拼接', () => {
    const sql = buildCreateTableSql({
      name: 't',
      columns: [col({ name: 'c', constraints: { defaultValue: 'CURRENT_TIMESTAMP' } })]
    })
    expect(sql).toContain('DEFAULT CURRENT_TIMESTAMP')
  })

  it('defaultValue 裸字符串加单引号并转义内部单引号', () => {
    const sql = buildCreateTableSql({
      name: 't',
      columns: [col({ name: 'c', constraints: { defaultValue: "it's" } })]
    })
    expect(sql).toContain("DEFAULT 'it''s'")
  })

  it('正常单列生成 DDL', () => {
    const sql = buildCreateTableSql({
      name: 't',
      columns: [col({ name: 'c' })]
    })
    expect(sql).toBe('CREATE TABLE IF NOT EXISTS "t" ("c" TEXT)')
  })

  it('主键+非空约束正确拼接', () => {
    const sql = buildCreateTableSql({
      name: 't',
      columns: [col({ name: 'c', type: 'INTEGER', constraints: { primaryKey: true, nullable: false } })]
    })
    expect(sql).toBe('CREATE TABLE IF NOT EXISTS "t" ("c" INTEGER PRIMARY KEY NOT NULL)')
  })

  it('表名含双引号被转义', () => {
    const sql = buildCreateTableSql({
      name: 't"x',
      columns: [col({ name: 'c' })]
    })
    expect(sql).toBe('CREATE TABLE IF NOT EXISTS "t""x" ("c" TEXT)')
  })
})
