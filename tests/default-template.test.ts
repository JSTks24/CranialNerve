import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateTableDef } from '../src/shared/table-validation'
import type { CardTemplate } from '../src/shared/types/card'

const template = JSON.parse(
  readFileSync(fileURLToPath(new URL('../tables/default-template.json', import.meta.url)), 'utf-8')
) as CardTemplate

describe('默认模板 重要角色表提示词注入', () => {
  it('important_characters 配置为 ai_prompt 模式且带 system 激活词指令', () => {
    const table = template.tables.find((t) => t.name === 'important_characters')
    expect(table).toBeDefined()
    const exportConfig = table!.exportConfig
    expect(exportConfig).toBeDefined()
    expect(exportConfig!.entryType).toBe('keyword')
    expect(exportConfig!.keywordMode).toBe('ai_prompt')
    expect(exportConfig!.keywordAiPrompt).toBeDefined()
    expect(exportConfig!.keywordAiPrompt!.length).toBeGreaterThan(0)
    const sysSeg = exportConfig!.keywordAiPrompt!.find((s) => s.role === 'system')
    expect(sysSeg).toBeDefined()
    expect(sysSeg!.content.length).toBeGreaterThan(0)
  })
})

describe('默认模板 5 表结构与新列', () => {
  it('恰含 5 张表且全局数据表排第一', () => {
    expect(template.templateVersion).toBe(2)
    const names = template.tables.map((t) => t.name)
    expect(names).toEqual([
      'global_data',
      'protagonist_info',
      'important_characters',
      'inventory',
      'quests_events'
    ])
  })

  it('全局数据表用固定值主键列保证单行', () => {
    const table = template.tables.find((t) => t.name === 'global_data')
    expect(table).toBeDefined()
    const pkCols = table!.columns.filter((c) => c.constraints?.primaryKey)
    expect(pkCols).toHaveLength(1)
    expect(pkCols[0]!.name).toBe('state_key')
  })

  it('全局数据表时间列精简：仅保留 cur_time', () => {
    const table = template.tables.find((t) => t.name === 'global_data')
    expect(table).toBeDefined()
    const cols = table!.columns.map((c) => c.name)
    expect(cols).toContain('cur_time')
    expect(cols).not.toContain('prev_scene_time')
    expect(cols).not.toContain('elapsed_time')
  })

  it('主角信息表含近况列，重要角色表含人际关系列', () => {
    const protagonist = template.tables.find((t) => t.name === 'protagonist_info')
    expect(protagonist?.columns.map((c) => c.name)).toContain('current_condition')
    const chars = template.tables.find((t) => t.name === 'important_characters')
    expect(chars?.columns.map((c) => c.name)).toContain('relation_text')
  })

  it('每张表导出顺序号唯一，单行发送全量', () => {
    const orders = template.tables.map((t) => t.exportConfig?.entryPlacement?.order)
    expect(new Set(orders).size).toBe(template.tables.length)
    for (const t of template.tables) {
      expect(t.exportConfig?.entryPlacement).toBeDefined()
      expect(t.updateConfig?.sendLatestRows).toBe(-1)
    }
    expect(template.tables.find((t) => t.name === 'global_data')?.exportConfig?.enabled).toBe(false)
    for (const t of template.tables) {
      if (t.name !== 'global_data') expect(t.exportConfig?.enabled).toBe(true)
    }
  })

  it('全部表通过 validateTableDef 校验', () => {
    for (const t of template.tables) {
      expect(validateTableDef(t, template.tables)).toBeNull()
    }
  })
})
