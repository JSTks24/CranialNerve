import { describe, expect, it } from 'vitest'
import { validateTableDef, validateChronicleDef } from '../src/shared/table-validation'
import type { TableDef, ColumnDef, ChronicleColumnRole } from '../src/shared/types/table'

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
  function chronicleCol(name: string, role: ChronicleColumnRole, display = name): ColumnDef {
    return { name, displayName: display, type: 'TEXT', note: '说明', role }
  }

  it('6 角色齐全且不重复返回 null', () => {
    const def: TableDef = {
      name: 'cn_chronicle',
      displayName: '纪要表',
      columns: [
        chronicleCol('key', 'key', '编码'),
        chronicleCol('time_start', 'timeStart', '起始时间'),
        chronicleCol('time_end', 'timeEnd', '结束时间'),
        chronicleCol('location', 'location', '地点'),
        chronicleCol('chronicle_text', 'summary', '纪要正文'),
        chronicleCol('key_dialogue', 'keyDialogue', '重要台词')
      ]
    }
    expect(validateChronicleDef(def)).toBeNull()
  })

  it('缺少角色报错', () => {
    const def: TableDef = {
      name: 'cn_chronicle',
      displayName: '纪要表',
      columns: [
        chronicleCol('key', 'key'),
        chronicleCol('time_start', 'timeStart'),
        chronicleCol('time_end', 'timeEnd'),
        chronicleCol('location', 'location'),
        chronicleCol('chronicle_text', 'summary')
      ]
    }
    expect(validateChronicleDef(def)).toContain('缺少角色')
  })

  it('列说明空报错', () => {
    const def: TableDef = {
      name: 'cn_chronicle',
      displayName: '纪要表',
      columns: [{ name: 'key', displayName: '编码', type: 'TEXT', role: 'key', note: '' }]
    }
    expect(validateChronicleDef(def)).toContain('列说明不能为空')
  })

  it('角色重复报错', () => {
    const def: TableDef = {
      name: 'cn_chronicle',
      displayName: '纪要表',
      columns: [
        chronicleCol('k1', 'key'),
        chronicleCol('k2', 'key'),
        chronicleCol('time_start', 'timeStart'),
        chronicleCol('time_end', 'timeEnd'),
        chronicleCol('location', 'location'),
        chronicleCol('chronicle_text', 'summary'),
        chronicleCol('key_dialogue', 'keyDialogue')
      ]
    }
    expect(validateChronicleDef(def)).toContain('角色重复')
  })
})
