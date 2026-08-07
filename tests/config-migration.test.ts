import { describe, expect, it, vi } from 'vitest'
import createConfigGateway from '../src/db/gateways/config'

function stubHost(extensionSettings: Record<string, unknown>, saveSettingsDebounced?: () => void) {
  const ctx = {
    extensionSettings,
    saveSettingsDebounced,
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    SillyTavern: { getContext: () => ctx },
  }
  return ctx
}

describe('配置 legacy 迁移与写失败提示（修复⑤⑥）', () => {
  it('read 迁移 legacy promptPresets 后删除旧键并持久化（修复⑤：不再每次 read 覆盖新配置）', () => {
    const saveSpy = vi.fn()
    const raw = {
      promptPresets: [
        { id: 'legacy1', name: 'legacy', templates: { tableEdit: [{ name: 's', role: 'user', content: 'x' }] } }
      ],
      activePromptPresetId: 'legacy1',
    }
    stubHost({ cranialnerve: raw }, saveSpy)
    const cfg = createConfigGateway().read()
    expect(cfg.prompt.tableEdit.presets.length).toBeGreaterThan(0)
    expect(raw.promptPresets).toBeUndefined()
    expect(raw.activePromptPresetId).toBeUndefined()
    expect(saveSpy).toHaveBeenCalled()
  })

  it('无 legacy 键时不触发保存（修复⑤：不重复写盘）', () => {
    const saveSpy = vi.fn()
    stubHost({ cranialnerve: {} }, saveSpy)
    createConfigGateway().read()
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('write 在 saveSettingsDebounced 可用时返回 true（修复⑥）', () => {
    const saveSpy = vi.fn()
    stubHost({ cranialnerve: {} }, saveSpy)
    const gw = createConfigGateway()
    const ok = gw.write({} as never)
    expect(ok).toBe(true)
    expect(saveSpy).toHaveBeenCalled()
  })

  it('write 在 saveSettingsDebounced 缺失时返回 false（修复⑥：调用方能提示用户）', () => {
    stubHost({ cranialnerve: {} })
    const gw = createConfigGateway()
    const ok = gw.write({} as never)
    expect(ok).toBe(false)
  })
})
