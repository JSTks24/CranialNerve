import { describe, expect, it, vi } from 'vitest'
import { buildTableEditPrompt } from '../src/core/table/prompt-builder'
import type { TableDef } from '../src/shared/types/table'
import type { PromptSegment } from '../src/shared/types/config'
import { CHRONICLE_TABLE_NAME } from '../src/shared/constants/chronicle'
import type SqliteCore from '../src/db/sqlite/core'

function mockCore(rows: Record<string, unknown>[]) {
  return {
    exec: vi.fn(() => [{ columns: ['c1', 'c2'], rows }])
  } as unknown as SqliteCore
}

function table(name: string, overrides: Partial<TableDef> = {}): TableDef {
  return {
    name,
    displayName: name,
    columns: [
      { name: 'c1', displayName: '列1', type: 'TEXT' },
      { name: 'c2', displayName: '列2', type: 'TEXT' }
    ],
    ...overrides
  }
}

function runBuild(core: SqliteCore, tableDefs: TableDef[], chronicleSendLatestRows?: number) {
  const segments: PromptSegment[] = [
    { id: 's1', name: '主指令', role: 'system', content: '{{tables}}' }
  ]
  const result = buildTableEditPrompt(core, {
    tableDefs,
    segments,
    chronicleSendLatestRows
  })
  return result.find((s) => s.name === '主指令')?.content ?? ''
}

describe('formatTableForAI 注释表格格式', () => {
  it('数据以 SQL 注释表格输出', () => {
    const core = mockCore([{ c1: 'v1', c2: 'v2' }])
    const text = runBuild(core, [table('t1')])
    expect(text).toContain('-- | c1 | c2 |')
    expect(text).toContain('-- | v1 | v2 |')
    expect(text).not.toContain('[{"c1":')
  })

  it('空表不输出表头行', () => {
    const core = mockCore([])
    const text = runBuild(core, [table('t1')])
    expect(text).toContain('-- 当前数据 (0 rows):')
    expect(text).not.toContain('-- | c1 | c2 |')
  })

  it('null 值单元格输出为空字符串', () => {
    const core = mockCore([{ c1: 'v1', c2: null }])
    const text = runBuild(core, [table('t1')])
    expect(text).toContain('-- | v1 |  |')
  })
})

describe('formatTableForAI 行数限制', () => {
  it('纪要表用 chronicleSendLatestRows 限制最近 N 条', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ c1: `k${i}`, c2: `s${i}` }))
    const core = mockCore(rows)
    const text = runBuild(core, [table(CHRONICLE_TABLE_NAME)], 10)
    expect(text).toContain('Showing last 10 of 15 entries')
    expect(text).toContain('-- 当前数据 (10 rows):')
    expect(text).toContain('k14')
    expect(text).not.toContain('k0')
  })

  it('普通表用 updateConfig.sendLatestRows 限制', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ c1: `a${i}`, c2: `b${i}` }))
    const core = mockCore(rows)
    const text = runBuild(core, [table('t1', { updateConfig: { sendLatestRows: 5 } })])
    expect(text).toContain('Showing last 5 of 20 entries')
    expect(text).toContain('-- 当前数据 (5 rows):')
    expect(text).toContain('a19')
    expect(text).not.toContain('a0')
  })

  it('普通表 sendLatestRows=-1 全量输出', () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ c1: `a${i}`, c2: `b${i}` }))
    const core = mockCore(rows)
    const text = runBuild(core, [table('t1', { updateConfig: { sendLatestRows: -1 } })])
    expect(text).not.toContain('Showing last')
    expect(text).toContain('-- 当前数据 (3 rows):')
  })

  it('纪要表 chronicleSendLatestRows 未传默认 10', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ c1: `k${i}`, c2: `s${i}` }))
    const core = mockCore(rows)
    const text = runBuild(core, [table(CHRONICLE_TABLE_NAME)])
    expect(text).toContain('Showing last 10 of 12 entries')
  })
})
