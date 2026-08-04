import { describe, expect, it } from 'vitest'
import { PROMPT_VARIABLES } from '@shared/constants'

describe('提示词变量说明数据', () => {
  it('表格更新变量名与 prompt-builder 插值入口一致（不含 chronicleGuide）', () => {
    const names = PROMPT_VARIABLES.tableEdit.variables.map((v) => v.name)
    expect(names).toEqual([
      'format',
      'timeFormat',
      'tables',
      'worldbook',
      'conversation',
      'persona',
      'charDescription'
    ])
    expect(names).not.toContain('chronicleGuide')
  })

  it('纪要召回变量名与 chronicle 插值入口一致', () => {
    const names = PROMPT_VARIABLES.chronicleRecall.variables.map((v) => v.name)
    expect(names).toEqual(['keyExample', 'chronicleList', 'userInput'])
  })

  it('每个变量 name 与 desc 非空', () => {
    for (const scene of Object.values(PROMPT_VARIABLES)) {
      for (const v of scene.variables) {
        expect(v.name, '变量 name 为空').toBeTruthy()
        expect(v.desc, `变量 ${v.name} 的 desc 为空`).toBeTruthy()
      }
    }
  })

  it('两个场景 label 非空', () => {
    expect(PROMPT_VARIABLES.tableEdit.label).toBeTruthy()
    expect(PROMPT_VARIABLES.chronicleRecall.label).toBeTruthy()
  })
})
