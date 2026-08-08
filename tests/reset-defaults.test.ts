import { describe, expect, it } from 'vitest'
import { applyDefaults } from '../src/shared/config-defaults'
import createConfigGateway from '../src/db/gateways/config'

function stubEmptyHost() {
  ;(globalThis as unknown as { window: unknown }).window = {
    SillyTavern: { getContext: () => ({ extensionSettings: {} }) },
  }
}

function makeConfig() {
  stubEmptyHost()
  const cfg = createConfigGateway().read()
  cfg.tableFill.batchSize = 999
  cfg.tableFill.autoFillTrigger = 'off'
  cfg.recallEnabled = false
  cfg.recallFadeMinDepth = 99
  cfg.snapshotStrategy = 'latest-only'
  cfg.checkpointInterval = 5
  cfg.vectorEnabled = true
  cfg.tableFillPresetId = 'keep-table'
  cfg.chronicleGenPresetId = 'keep-chronicle'
  cfg.recallPresetId = 'keep-recall'
  cfg.prompt.tableEdit.activeId = 'keep-prompt'
  cfg.aiPresets = []
  return cfg
}

describe('applyDefaults 重置运行参数', () => {
  it('重置 tableFill/chronicleFill/recall/存储/pending/vector 字段', () => {
    const cfg = makeConfig()
    applyDefaults(cfg)
    expect(cfg.tableFill.batchSize).toBe(10)
    expect(cfg.tableFill.autoFillTrigger).toBe('after-ai')
    expect(cfg.chronicleFill.batchSize).toBe(10)
    expect(cfg.recallEnabled).toBe(true)
    expect(cfg.recallFadeMinDepth).toBe(2)
    expect(cfg.snapshotStrategy).toBe('every-message')
    expect(cfg.checkpointInterval).toBe(20)
    expect(cfg.retainFloors).toBe(100)
    expect(cfg.vectorEnabled).toBe(false)
    expect(cfg.vector.embeddingEndpoint).toBe('')
    expect(cfg.pending.aiCallTimeoutMs).toBe(0)
    expect(cfg.pending.minSummaryLength).toBe(100)
  })

  it('保留三个 AI 预设关联 ID（不清空）', () => {
    const cfg = makeConfig()
    applyDefaults(cfg)
    expect(cfg.tableFillPresetId).toBe('keep-table')
    expect(cfg.chronicleGenPresetId).toBe('keep-chronicle')
    expect(cfg.recallPresetId).toBe('keep-recall')
  })

  it('保留 prompt 与 aiPresets/tableTemplate/chronicleTableDef', () => {
    const cfg = makeConfig()
    const tableTemplate = cfg.tableTemplate
    const chronicleTableDef = cfg.chronicleTableDef
    applyDefaults(cfg)
    expect(cfg.prompt.tableEdit.activeId).toBe('keep-prompt')
    expect(cfg.aiPresets).toEqual([])
    expect(cfg.tableTemplate).toBe(tableTemplate)
    expect(cfg.chronicleTableDef).toBe(chronicleTableDef)
  })
})
