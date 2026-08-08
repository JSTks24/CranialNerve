import { describe, expect, it } from 'vitest'
import createConfigGateway from '../src/db/gateways/config'
import { RECALL_FADE_MIN_DEPTH, resolveFadeMinDepth } from '../src/shared/constants'

function stubEmptyHost() {
  ;(globalThis as unknown as { window: unknown }).window = {
    SillyTavern: { getContext: () => ({ extensionSettings: {} }) },
  }
}

describe('config 默认值 null 语义', () => {
  it('manualUpdateContextDepth/manualUpdateBatchSize 默认 null', () => {
    stubEmptyHost()
    const cfg = createConfigGateway().read()
    expect(cfg.tableFill.manualUpdateContextDepth).toBeNull()
    expect(cfg.tableFill.manualUpdateBatchSize).toBeNull()
  })

  it('tableFill 无 groupId（已删除）', () => {
    stubEmptyHost()
    const cfg = createConfigGateway().read()
    expect((cfg.tableFill as unknown as Record<string, unknown>).groupId).toBeUndefined()
  })

  it('autoFillTrigger 默认 after-ai，regenerateFill 默认 true', () => {
    stubEmptyHost()
    const cfg = createConfigGateway().read()
    expect(cfg.tableFill.autoFillTrigger).toBe('after-ai')
    expect(cfg.tableFill.regenerateFill).toBe(true)
  })

  it('aiCallTimeoutMs 默认 0（永不超时）', () => {
    stubEmptyHost()
    const cfg = createConfigGateway().read()
    expect(cfg.pending.aiCallTimeoutMs).toBe(0)
  })

  it('legacy 配置无 recallFadeMinDepth → 默认 2（向后兼容）', () => {
    ;(globalThis as unknown as { window: unknown }).window = {
      SillyTavern: {
        getContext: () => ({
          extensionSettings: {
            cranialnerve: {
              recallEnabled: true,
              recallMinScore: 0.45,
            },
          },
        }),
      },
    }
    const cfg = createConfigGateway().read()
    expect(cfg.recallFadeMinDepth).toBe(2)
    expect(cfg.recallMinScore).toBe(0.45)
  })

  it('seed 默认 null（emptyPreset 经 gateway 读取为 null）', () => {
    ;(globalThis as unknown as { window: unknown }).window = {
      SillyTavern: {
        getContext: () => ({
          extensionSettings: {
            cranialnerve: {
              aiPresets: [{ id: 'p1', name: 'p', baseURL: '', apiKey: '', model: '', maxTokens: 1, temperature: 1, topP: 1, frequencyPenalty: 0, presencePenalty: 0, seed: null, stream: false, customIncludeBody: '', customExcludeBody: '', customIncludeHeaders: '' }],
            },
          },
        }),
      },
    }
    const cfg = createConfigGateway().read()
    expect(cfg.aiPresets[0]!.seed).toBeNull()
  })
})

describe('resolveFadeMinDepth', () => {
  it('undefined/null → 回退默认 2', () => {
    expect(resolveFadeMinDepth(undefined)).toBe(RECALL_FADE_MIN_DEPTH)
    expect(resolveFadeMinDepth(null)).toBe(RECALL_FADE_MIN_DEPTH)
  })

  it('NaN/负数 → 回退默认 2', () => {
    expect(resolveFadeMinDepth(Number.NaN)).toBe(RECALL_FADE_MIN_DEPTH)
    expect(resolveFadeMinDepth(-1)).toBe(RECALL_FADE_MIN_DEPTH)
  })

  it('0 → 0（永不消逝）', () => {
    expect(resolveFadeMinDepth(0)).toBe(0)
  })

  it('正常值原样返回', () => {
    expect(resolveFadeMinDepth(3)).toBe(3)
  })

  it('小数截断', () => {
    expect(resolveFadeMinDepth(2.9)).toBe(2)
  })
})
