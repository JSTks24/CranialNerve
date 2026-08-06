import { describe, expect, it, vi } from 'vitest'
import { buildChronicleGenPrompt, buildMergedPrompt } from '../src/core/table/prompt-builder'
import type { TableDef } from '../src/shared/types/table'
import { CHRONICLE_TABLE_NAME } from '../src/shared/constants/chronicle'
import type SqliteCore from '../src/db/sqlite/core'

function mockCore(): SqliteCore {
  return {
    exec: vi.fn((sql: string) => {
      if (sql.includes('hero')) {
        return [{ columns: ['name', 'hp'], rows: [{ name: '勇者', hp: 100 }] }]
      }
      if (sql.includes(CHRONICLE_TABLE_NAME)) {
        return [{
          columns: ['key', 'chronicle_text', 'location', 'important_word', 'time_start', 'time_end', 'story_time'],
          rows: [{ key: 'CN0001', chronicle_text: '主角抵达王都', location: '王都', important_word: '', time_start: '', time_end: '', story_time: '' }]
        }]
      }
      return [{ columns: [], rows: [] }]
    })
  } as unknown as SqliteCore
}

const chronicleTableDef: TableDef = {
  name: CHRONICLE_TABLE_NAME,
  displayName: '纪要表',
  columns: [
    { name: 'key', displayName: '编码', type: 'TEXT' },
    { name: 'chronicle_text', displayName: '纪要正文', type: 'TEXT' },
    { name: 'location', displayName: '地点', type: 'TEXT' },
    { name: 'important_word', displayName: '重要词', type: 'TEXT' },
    { name: 'time_start', displayName: '开始时间', type: 'TEXT' },
    { name: 'time_end', displayName: '结束时间', type: 'TEXT' },
    { name: 'story_time', displayName: '故事时间', type: 'TEXT' }
  ]
}

const heroTableDef: TableDef = {
  name: 'hero',
  displayName: '英雄表',
  columns: [
    { name: 'name', displayName: '名字', type: 'TEXT' },
    { name: 'hp', displayName: '血量', type: 'INTEGER' }
  ]
}

describe('buildChronicleGenPrompt', () => {
  it('chronicleTable 变量注入纪要表数据', () => {
    const core = mockCore()
    const segs = buildChronicleGenPrompt(core, {
      chronicleTableDef,
      chronicleSendLatestRows: 10,
      conversationText: '本轮正文',
      segments: [
        { id: 'm', name: '主指令', role: 'system', content: '指令 {{chronicleTable}} {{conversation}}' }
      ]
    })
    const main = segs.find((s) => s.name === '主指令')!
    expect(main.content).toContain('CN0001')
    expect(main.content).toContain('主角抵达王都')
    expect(main.content).toContain('本轮正文')
  })

  it('共有变量 worldbook/persona/charDescription 注入', () => {
    const core = mockCore()
    const segs = buildChronicleGenPrompt(core, {
      chronicleTableDef,
      chronicleSendLatestRows: 10,
      worldbookContent: '世界书设定',
      personaDescription: '人设X',
      charDescription: '角色Y',
      segments: [
        { id: 'm', name: '主指令', role: 'system', content: '{{worldbook}}|{{persona}}|{{charDescription}}' }
      ]
    })
    const main = segs.find((s) => s.name === '主指令')!
    expect(main.content).toBe('世界书设定|人设X|角色Y')
  })
})

describe('buildMergedPrompt 去重', () => {
  it('共有段去重留一份，主指令各自保留', () => {
    const core = mockCore()
    const sharedContent = '<背景设定>\n{{worldbook}}\n</背景设定>'
    const segs = buildMergedPrompt(core, {
      tableDefs: [heroTableDef],
      chronicleTableDef,
      chronicleSendLatestRows: 10,
      worldbookContent: '世界书内容',
      conversationText: '本轮正文',
      tableSegments: [
        { id: 'tm', name: '主指令', role: 'system', content: '填表指令 {{tables}}' },
        { id: 'tw', name: '世界书上下文', role: 'system', content: sharedContent }
      ],
      chronicleSegments: [
        { id: 'cm', name: '主指令', role: 'system', content: '纪要生成指令 {{chronicleTable}}' },
        { id: 'cw', name: '世界书上下文', role: 'system', content: sharedContent }
      ]
    })
    const worldbookSegs = segs.filter((s) => s.name === '世界书上下文')
    expect(worldbookSegs).toHaveLength(1)
    const mainSegs = segs.filter((s) => s.name === '主指令')
    expect(mainSegs).toHaveLength(2)
    const contents = mainSegs.map((s) => s.content)
    expect(contents.some((c) => c.includes('填表指令'))).toBe(true)
    expect(contents.some((c) => c.includes('纪要生成指令'))).toBe(true)
  })

  it('tables 与 chronicleTable 各自注入不串扰', () => {
    const core = mockCore()
    const segs = buildMergedPrompt(core, {
      tableDefs: [heroTableDef],
      chronicleTableDef,
      chronicleSendLatestRows: 10,
      tableSegments: [
        { id: 'tm', name: '表指令', role: 'system', content: 'T:{{tables}}' }
      ],
      chronicleSegments: [
        { id: 'cm', name: '纪要指令', role: 'system', content: 'C:{{chronicleTable}}' }
      ]
    })
    const t = segs.find((s) => s.content.startsWith('T:'))!
    const c = segs.find((s) => s.content.startsWith('C:'))!
    expect(t.content).toContain('hero')
    expect(t.content).not.toContain('CN0001')
    expect(c.content).toContain('CN0001')
    expect(c.content).not.toContain('hero')
  })
})
