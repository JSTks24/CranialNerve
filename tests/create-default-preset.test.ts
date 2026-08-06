import { describe, expect, it } from 'vitest'
import {
  createDefaultPreset,
  getDefaultTableEditPrompt,
  setDefaultPrompts
} from '../src/shared/prompts/defaults'
import { createUserTemplatePreset } from '../src/shared/template-convert'
import { CHRONICLE_TABLE_NAME } from '../src/shared/constants/chronicle'
import type { CardTemplate } from '../src/shared/types/card'

setDefaultPrompts(
  [
    { name: '主指令', role: 'system', content: 'AAA' },
    { name: '补充', role: 'user', content: 'BBB' }
  ],
  [{ name: '纪要生成指令', role: 'system', content: 'GGG' }],
  [{ name: '纪要指令', role: 'system', content: 'CCC' }]
)

describe('createDefaultPreset', () => {
  it('生成独立的新预设并重建 segment id', () => {
    const p = createDefaultPreset('tableEdit')
    expect(p.id).toMatch(/^preset_[a-z0-9]{8}$/)
    expect(p.name).toBe('默认提示词副本')
    expect(p.segments).toHaveLength(2)
    const src = getDefaultTableEditPrompt()
    expect(p.segments).not.toBe(src)
    p.segments.forEach((s, i) => {
      expect(s.id).toMatch(/^seg_[a-z0-9]{8}$/)
      expect(s.id).not.toBe(src[i]!.id)
      expect(s.name).toBe(src[i]!.name)
      expect(s.role).toBe(src[i]!.role)
      expect(s.content).toBe(src[i]!.content)
      expect(s).not.toBe(src[i])
    })
  })

  it('chronicleRecall 场景取纪要默认段', () => {
    const p = createDefaultPreset('chronicleRecall')
    expect(p.segments).toHaveLength(1)
    expect(p.segments[0]!.name).toBe('纪要指令')
    expect(p.segments[0]!.content).toBe('CCC')
  })

  it('chronicleGen 场景取纪要生成默认段', () => {
    const p = createDefaultPreset('chronicleGen')
    expect(p.segments).toHaveLength(1)
    expect(p.segments[0]!.name).toBe('纪要生成指令')
    expect(p.segments[0]!.content).toBe('GGG')
  })

  it('多次创建互不共享', () => {
    const a = createDefaultPreset('tableEdit')
    const b = createDefaultPreset('tableEdit')
    expect(a.id).not.toBe(b.id)
    expect(a.segments).not.toBe(b.segments)
    expect(a.segments[0]).not.toBe(b.segments[0])
    expect(a.segments[0]!.id).not.toBe(b.segments[0]!.id)
    a.segments[0]!.content = 'ZZZ'
    expect(b.segments[0]!.content).toBe('AAA')
    expect(getDefaultTableEditPrompt()[0]!.content).toBe('AAA')
  })
})

describe('createUserTemplatePreset', () => {
  const fixture: CardTemplate = {
    templateVersion: 1,
    tables: [
      {
        name: 't1',
        displayName: 'T1',
        columns: [
          { name: 'id', displayName: 'ID', type: 'TEXT', constraints: { primaryKey: true } }
        ],
        exportConfig: {
          enabled: true,
          entryType: 'constant',
          keywordColumn: '',
          keywordAiPrompt: [{ id: 'x', name: 's', role: 'system', content: 'hi' }]
        }
      }
    ]
  }

  it('null 输入返回 null', () => {
    expect(createUserTemplatePreset(null)).toBeNull()
  })

  it('构造 source=user 预设并全深度深拷贝', () => {
    const p = createUserTemplatePreset(fixture)
    expect(p).not.toBeNull()
    expect(p!.id).toMatch(/^tpl_[a-z0-9]{8}$/)
    expect(p!.name).toBe('默认模板副本')
    expect(p!.source).toBe('user')
    expect(p!.template).not.toBe(fixture)
    expect(p!.template.tables).not.toBe(fixture.tables)
    expect(p!.template.tables[0]).not.toBe(fixture.tables[0])
    expect(p!.template.tables[0]!.exportConfig).not.toBe(fixture.tables[0]!.exportConfig)
    expect(p!.template.tables[0]!.exportConfig!.keywordAiPrompt![0]).not.toBe(
      fixture.tables[0]!.exportConfig!.keywordAiPrompt![0]
    )
    expect(p!.template.templateVersion).toBe(1)
    expect(p!.template.tables).toHaveLength(1)
    expect(p!.template.tables[0]!.exportConfig!.keywordAiPrompt![0]!.content).toBe('hi')
  })

  it('修改副本不影响原模板', () => {
    const p = createUserTemplatePreset(fixture)
    p!.template.tables[0]!.name = 'changed'
    p!.template.tables[0]!.exportConfig!.keywordAiPrompt![0]!.content = 'changed'
    expect(fixture.tables[0]!.name).toBe('t1')
    expect(fixture.tables[0]!.exportConfig!.keywordAiPrompt![0]!.content).toBe('hi')
  })

  it('cn_chronicle 表被强制禁用且原模板不受影响', () => {
    const withChronicle: CardTemplate = {
      templateVersion: 1,
      tables: [
        { name: CHRONICLE_TABLE_NAME, displayName: '纪要', columns: [], enabled: true },
        { name: 'normal', displayName: '普通', columns: [] }
      ]
    }
    const p = createUserTemplatePreset(withChronicle)
    const chronicle = p!.template.tables.find((t) => t.name === CHRONICLE_TABLE_NAME)!
    const normal = p!.template.tables.find((t) => t.name === 'normal')!
    expect(chronicle.enabled).toBe(false)
    expect(normal.enabled).toBeUndefined()
    expect(withChronicle.tables.find((t) => t.name === CHRONICLE_TABLE_NAME)!.enabled).toBe(true)
  })
})
