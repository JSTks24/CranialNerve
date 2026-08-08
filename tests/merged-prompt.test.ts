import { describe, expect, it, vi } from 'vitest'
import { buildMergedPrompt } from '../src/core/table/prompt-builder'
import type { TableDef } from '../src/shared/types/table'
import type { PromptSegment } from '../src/shared/types/config'
import { CHRONICLE_TABLE_NAME } from '../src/shared/constants/chronicle'
import type SqliteCore from '../src/db/sqlite/core'

function mockCore(): SqliteCore {
  return {
    exec: vi.fn((sql: string) => {
      if (sql.includes('hero')) {
        return [{ columns: ['name', 'hp'], rows: [{ name: '勇者', hp: 100 }] }]
      }
      if (sql.includes(CHRONICLE_TABLE_NAME)) {
        return [{ columns: ['key', 'chronicle_text'], rows: [{ key: 'CN0001', chronicle_text: '主角抵达王都' }] }]
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
    { name: 'chronicle_text', displayName: '纪要正文', type: 'TEXT' }
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

function buildMain(overrides: {
  tableSegments?: PromptSegment[]
  chronicleSegments?: PromptSegment[]
} = {}): string {
  const core = mockCore()
  const segs = buildMergedPrompt(core, {
    tableDefs: [heroTableDef],
    chronicleTableDef,
    chronicleSendLatestRows: 10,
    tableSegments: overrides.tableSegments ?? [],
    chronicleSegments: overrides.chronicleSegments ?? []
  })
  return segs.find((s) => s.name === '主指令')?.content ?? ''
}

describe('buildMergedPrompt 融合主指令', () => {
  it('总纲含关键约束：每轮必写纪要/系统自动分类/禁 UPDATE DELETE 纪要/分号多语句', () => {
    const main = buildMain({
      tableSegments: [{ id: 'tm', name: '主指令', role: 'system', content: '填表 {{tables}}' }],
      chronicleSegments: [{ id: 'cm', name: '主指令', role: 'system', content: '纪要 {{chronicleTable}}' }]
    })
    expect(main).toContain('每轮必写')
    expect(main).toContain('sql 字段不允许为空字符串')
    expect(main).toContain('系统会自动按 SQL 内容分类')
    expect(main).toContain('禁止对纪要表使用 UPDATE/DELETE')
    expect(main).toContain('分号分隔')
    expect(main).toContain('table_edit_sql_v1')
  })

  it('用户自定义表格主指令内容原样保留（如表规则禁止删除）', () => {
    const main = buildMain({
      tableSegments: [{ id: 'tm', name: '主指令', role: 'system', content: 'hero 表禁止 DELETE，只能 UPDATE 状态 {{tables}}' }]
    })
    expect(main).toContain('hero 表禁止 DELETE')
    expect(main).toContain('只能 UPDATE 状态')
  })

  it('用户自定义纪要主指令内容原样保留', () => {
    const main = buildMain({
      chronicleSegments: [{ id: 'cm', name: '主指令', role: 'system', content: '纪要必须客观叙述，禁止主观猜测 {{chronicleTable}}' }]
    })
    expect(main).toContain('纪要必须客观叙述')
    expect(main).toContain('禁止主观猜测')
  })

  it('总纲禁止留空覆盖用户表格主指令的留空表述', () => {
    const main = buildMain({
      tableSegments: [{ id: 'tm', name: '主指令', role: 'system', content: '某轮无变更时 sql 留空字符串 {{tables}}' }]
    })
    expect(main).toContain('禁止留空')
    expect(main).toContain('只写纪要 INSERT')
    expect(main).not.toContain('留空字符串')
  })

  it('默认表格主指令的"留空字符串"冲突句被改写，其余内容保留', () => {
    const defaultTableMain = [
      '你是【CranialNerve 填表AI】，负责根据故事内容对数据库表格执行增删改操作。',
      '## 输出格式（严格执行）',
      '- 某一轮没有需要修改的表时，该元素的 sql 留空字符串 ""',
      '## 填表约束',
      '8. 某一轮没有需要修改的表时，该轮的 sql 字段留空字符串',
      '## 当前数据库结构、数据与提示如下：',
      '{{tables}}'
    ].join('\n')
    const main = buildMain({
      tableSegments: [{ id: 'tm', name: '主指令', role: 'system', content: defaultTableMain }]
    })
    expect(main).not.toContain('留空字符串')
    expect(main).toContain('只写纪要 INSERT')
    expect(main).toContain('当前数据库结构')
  })

  it('默认纪要主指令的 key 序号句被改写为系统改写说明', () => {
    const defaultChronicleMain = [
      '你是【CranialNerve 纪要生成AI】，负责根据故事内容为纪要表生成新记录。',
      '- 每个元素的 sql 字段必须包含对纪要表的一整条 INSERT（key 在现有最大序号基础上按轮次依次递增）',
      '- key 列用 CNXXXX 编码，查现有最大序号 +1',
      '- 若本次包含多轮对话，每轮 INSERT 一条纪要，key 依次递增（如 CN0005、CN0006…），在现有最大序号基础上按轮次依次 +1',
      '## 当前纪要表结构、数据与提示如下：',
      '{{chronicleTable}}'
    ].join('\n')
    const main = buildMain({
      chronicleSegments: [{ id: 'cm', name: '主指令', role: 'system', content: defaultChronicleMain }]
    })
    expect(main).toContain('无需自行查最大序号')
    expect(main).toContain('系统会自动改写为正确的楼层序号')
    expect(main).not.toContain('现有最大序号基础上')
    expect(main).not.toContain('CN0005')
  })

  it('总纲含防偷懒句与 key 系统改写说明', () => {
    const main = buildMain()
    expect(main).toContain('禁止以“该轮没有表格变化”为由省略实际存在的表格变更')
    expect(main).toContain('只有确认所有表都无变化时，才允许该轮只写纪要 INSERT')
    expect(main).toContain('无需自行查最大序号')
  })

  it('冲突句改写后用户自定义内容仍原样保留', () => {
    const main = buildMain({
      tableSegments: [{
        id: 'tm',
        name: '主指令',
        role: 'system',
        content: 'hero 表禁止 DELETE；某轮无变更时 sql 留空字符串 {{tables}}'
      }]
    })
    expect(main).toContain('hero 表禁止 DELETE')
    expect(main).toContain('只写纪要 INSERT')
    expect(main).not.toContain('留空字符串')
  })

  it('“留空字符串”在 sql 之前的顺序同样被改写', () => {
    const main = buildMain({
      tableSegments: [{
        id: 'tm',
        name: '主指令',
        role: 'system',
        content: '某轮无变更时留空字符串 sql 必须写内容 {{tables}}'
      }]
    })
    expect(main).toContain('只写纪要 INSERT')
    expect(main).not.toContain('留空字符串')
  })

  it('用户模板含未知变量时原样保留不报错', () => {
    const main = buildMain({
      tableSegments: [{
        id: 'tm',
        name: '主指令',
        role: 'system',
        content: '自定义 {{my_custom_var}} 规则 {{tables}}'
      }]
    })
    expect(main).toContain('{{my_custom_var}}')
    expect(main).toContain('自定义')
  })

  it('变量值全空时正常拼装不报错', () => {
    const core = mockCore()
    const segs = buildMergedPrompt(core, {
      tableDefs: [heroTableDef],
      chronicleTableDef,
      chronicleSendLatestRows: 10,
      worldbookContent: '',
      conversationText: '',
      personaDescription: '',
      charDescription: '',
      tableSegments: [],
      chronicleSegments: []
    })
    const main = segs.find((s) => s.name === '主指令')?.content ?? ''
    expect(main).toContain('每轮必写')
    expect(main).toContain('## 当前数据库结构')
  })

  it('总纲含输出示例与加粗关键约束（AI 注意力强化）', () => {
    const main = buildMain()
    expect(main).toContain('## 输出示例')
    expect(main).toContain('**每轮必写**')
    expect(main).toContain('**sql 字段不允许为空字符串**')
    expect(main).toContain('**禁止以“该轮没有表格变化”为由省略实际存在的表格变更**')
    expect(main).toContain('示例第二个元素只有纪要 INSERT')
  })

  it('子指令标题含冲突覆盖提示', () => {
    const main = buildMain({
      tableSegments: [{ id: 'tm', name: '主指令', role: 'system', content: '规则 {{tables}}' }],
      chronicleSegments: [{ id: 'cm', name: '主指令', role: 'system', content: '规则 {{chronicleTable}}' }]
    })
    expect(main).toContain('【表格更新要求】（与上方“输出结构”冲突处，以输出结构为准）')
    expect(main).toContain('【纪要生成要求】（与上方“输出结构”冲突处，以输出结构为准）')
  })

  it('表格主指令缺 {{tables}} 时仍嵌入并兜底补齐数据区', () => {
    const main = buildMain({
      tableSegments: [{ id: 'tm', name: '主指令', role: 'system', content: '自定义表格规则（无数据区）' }],
      chronicleSegments: [{ id: 'cm', name: '主指令', role: 'system', content: '自定义纪要规则 {{chronicleTable}}' }]
    })
    expect(main).toContain('自定义表格规则')
    expect(main).toContain('## 当前数据库结构')
    expect(main).toContain('hero')
    expect(main).toContain('勇者')
  })

  it('两份主指令均缺失时回退总纲+兜底数据区，不裸提示', () => {
    const main = buildMain()
    expect(main).toContain('每轮必写')
    expect(main).toContain('## 当前数据库结构')
    expect(main).toContain('hero')
    expect(main).toContain('## 当前纪要表结构')
    expect(main).toContain('CN0001')
  })

  it('共有段去重留一份，主指令融合为一份', () => {
    const core = mockCore()
    const sharedContent = '<背景设定>\n{{worldbook}}\n</背景设定>'
    const segs = buildMergedPrompt(core, {
      tableDefs: [heroTableDef],
      chronicleTableDef,
      chronicleSendLatestRows: 10,
      worldbookContent: '世界书内容',
      tableSegments: [
        { id: 'tw', name: '世界书上下文', role: 'system', content: sharedContent }
      ],
      chronicleSegments: [
        { id: 'cw', name: '世界书上下文', role: 'system', content: sharedContent }
      ]
    })
    expect(segs.filter((s) => s.name === '世界书上下文')).toHaveLength(1)
    expect(segs.filter((s) => s.name === '主指令')).toHaveLength(1)
  })
})
