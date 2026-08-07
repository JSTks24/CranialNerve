import { describe, expect, it } from 'vitest'
import { convertShujukuToCardTemplate } from '../src/shared/template-convert'

describe('shujuku DDL 解析', () => {
  it('解析 col TYPE, -- 注释 格式，过滤 row_id，displayName 从 header 补', () => {
    const shujuku = {
      mate: { type: 'chatSheets', version: 2 },
      sheet_0: {
        uid: 'sheet_t1',
        name: '表1',
        sourceData: {
          ddl: 'CREATE TABLE t1 (\n  row_id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL, -- 姓名\n  age INTEGER -- 年龄\n);'
        },
        content: [['row_id', '姓名', '年龄']]
      }
    }
    const back = convertShujukuToCardTemplate(shujuku as never)
    expect(back.tables[0]?.columns.map((c) => c.name)).toEqual(['name', 'age'])
    expect(back.tables[0]?.columns[0]?.displayName).toBe('姓名')
    expect(back.tables[0]?.columns[1]?.displayName).toBe('年龄')
  })

  it('DDL 含 CHECK 约束正确解析列名', () => {
    const shujuku = {
      mate: { type: 'chatSheets', version: 2 },
      sheet_0: {
        uid: 'sheet_t1',
        name: '表1',
        sourceData: {
          ddl: 'CREATE TABLE t1 (\n  row_id INTEGER PRIMARY KEY CHECK(row_id = 1), -- 行号\n  status TEXT CHECK(LENGTH(status) <= 30) -- 状态\n);'
        },
        content: [['row_id', '状态']]
      }
    }
    const back = convertShujukuToCardTemplate(shujuku as never)
    expect(back.tables[0]?.columns.map((c) => c.name)).toEqual(['status'])
    expect(back.tables[0]?.columns[0]?.displayName).toBe('状态')
  })

  it('DEFAULT 字符串字面量保留引号', () => {
    const shujuku = {
      mate: { type: 'chatSheets', version: 2 },
      sheet_0: {
        uid: 'sheet_t1',
        name: '表1',
        sourceData: {
          ddl: "CREATE TABLE t1 (\n  row_id INTEGER PRIMARY KEY,\n  status TEXT DEFAULT 'foo(bar)'\n);"
        },
        content: [['row_id', '状态']]
      }
    }
    const back = convertShujukuToCardTemplate(shujuku as never)
    expect(back.tables[0]?.columns[0]?.constraints?.defaultValue).toBe("'foo(bar)'")
  })

  it('纪要表 sheet 保留但标记 enabled=false（不删除，可手动启用）', () => {
    const shujuku = {
      mate: { type: 'chatSheets', version: 2 },
      sheet_0: {
        uid: 'sheet_t1',
        name: '表1',
        sourceData: { ddl: 'CREATE TABLE t1 (c1 TEXT)' },
        content: [['c1']]
      },
      sheet_1: {
        uid: 'sheet_chronicle',
        name: '纪要表',
        sourceData: { ddl: 'CREATE TABLE chronicle (c1 TEXT)' },
        content: [['c1']]
      }
    }
    const back = convertShujukuToCardTemplate(shujuku as never)
    expect(back.tables).toHaveLength(2)
    const chronicle = back.tables.find((t) => t.name === 'chronicle')
    expect(chronicle).toBeDefined()
    expect(chronicle?.enabled).toBe(false)
    const normal = back.tables.find((t) => t.name === 't1')
    expect(normal?.enabled).toBeUndefined()
  })
})

describe('updateConfig 导入', () => {
  it('shujuku->CN: sendLatestRows 读入 TableDef.updateConfig', () => {
    const shujuku = {
      mate: { type: 'chatSheets', version: 2, updateConfigUiSentinel: -1 },
      sheet_0: {
        uid: 'sheet_t1',
        name: '表1',
        sourceData: { ddl: 'CREATE TABLE t1 (\n  row_id INTEGER PRIMARY KEY,\n  c1 TEXT\n);' },
        content: [['row_id', '列1']],
        updateConfig: { sendLatestRows: 8 }
      }
    }
    const back = convertShujukuToCardTemplate(shujuku as never)
    expect(back.tables[0]?.updateConfig?.sendLatestRows).toBe(8)
  })

  it('shujuku->CN: 无 sendLatestRows 时 updateConfig 为 undefined', () => {
    const shujuku = {
      mate: { type: 'chatSheets', version: 2, updateConfigUiSentinel: -1 },
      sheet_0: {
        uid: 'sheet_t1',
        name: '表1',
        sourceData: { ddl: 'CREATE TABLE t1 (c1 TEXT)' },
        content: [['c1']]
      }
    }
    const back = convertShujukuToCardTemplate(shujuku)
    expect(back.tables[0]?.updateConfig).toBeUndefined()
  })
})
