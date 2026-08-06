import { describe, expect, it } from 'vitest'
import { validateTableDef, validateChronicleDef } from '../src/shared/table-validation'
import type { TableDef, ColumnDef } from '../src/shared/types/table'

function makeTable(overrides: Partial<TableDef> = {}): TableDef {
  return {
    name: 't1',
    displayName: '表1',
    columns: [{ name: 'c1', displayName: '列1', type: 'TEXT' }],
    ...overrides
  }
}

describe('validateTableDef', () => {
  it('合法表返回 null', () => {
    const t = makeTable()
    expect(validateTableDef(t, [t])).toBeNull()
  })

  it('英文表名空', () => {
    const t = makeTable({ name: '' })
    expect(validateTableDef(t, [t])).toBe('英文表名不能为空')
  })

  it('中文表名空', () => {
    const t = makeTable({ displayName: '' })
    expect(validateTableDef(t, [t])).toBe('中文表名不能为空')
  })

  it('无列', () => {
    const t = makeTable({ columns: [] })
    expect(validateTableDef(t, [t])).toBe('至少需要一列')
  })

  it('列英文名重复', () => {
    const t = makeTable({
      columns: [
        { name: 'c1', displayName: '列1', type: 'TEXT' },
        { name: 'c1', displayName: '列2', type: 'TEXT' }
      ]
    })
    expect(validateTableDef(t, [t])).toContain('列英文名重复')
  })

  it('keyword+custom 无 keywordColumn 报错', () => {
    const t = makeTable({
      exportConfig: {
        enabled: true,
        entryType: 'keyword',
        keywordColumn: '',
        keywordMode: 'custom'
      }
    })
    expect(validateTableDef(t, [t])).toContain('关键词列不能为空')
  })

  it('keyword+custom 有 keywordColumn 通过', () => {
    const t = makeTable({
      exportConfig: {
        enabled: true,
        entryType: 'keyword',
        keywordColumn: 'c1',
        keywordMode: 'custom'
      }
    })
    expect(validateTableDef(t, [t])).toBeNull()
  })

  it('keyword+ai_prompt 通过（无需提示词）', () => {
    const t = makeTable({
      exportConfig: {
        enabled: true,
        entryType: 'keyword',
        keywordColumn: '',
        keywordMode: 'ai_prompt'
      }
    })
    expect(validateTableDef(t, [t])).toBeNull()
  })

  it('表英文名重复', () => {
    const t1 = makeTable()
    const t2 = makeTable({ displayName: '表2' })
    expect(validateTableDef(t1, [t1, t2])).toContain('表英文名重复')
  })
})

describe('validateChronicleDef', () => {
  function chronicleCol(name: string, display = name, note = '说明'): ColumnDef {
    return { name, displayName: display, type: 'TEXT', note }
  }

  function fullChronicle(): TableDef {
    return {
      name: 'cn_chronicle',
      displayName: '纪要表',
      columns: [
        chronicleCol('key', '编码'),
        chronicleCol('time_start', '起始时间'),
        chronicleCol('time_end', '结束时间'),
        chronicleCol('location', '地点'),
        chronicleCol('chronicle_text', '纪要正文'),
        chronicleCol('important_word', '记忆索引')
      ]
    }
  }

  it('6 固定列齐全返回 null', () => {
    expect(validateChronicleDef(fullChronicle())).toBeNull()
  })

  it('缺少固定列报错', () => {
    const def = fullChronicle()
    def.columns = def.columns.filter((c) => c.name !== 'location')
    expect(validateChronicleDef(def)).toContain('缺少固定列')
  })

  it('列说明空报错', () => {
    const def: TableDef = {
      name: 'cn_chronicle',
      displayName: '纪要表',
      columns: [{ name: 'key', displayName: '编码', type: 'TEXT', note: '' }]
    }
    expect(validateChronicleDef(def)).toContain('列说明不能为空')
  })

  it('列英文名重复报错', () => {
    const def = fullChronicle()
    def.columns.push(chronicleCol('key', '重复'))
    expect(validateChronicleDef(def)).toContain('列英文名重复')
  })
})
