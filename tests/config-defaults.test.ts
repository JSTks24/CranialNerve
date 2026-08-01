import { describe, expect, it } from 'vitest'
import createConfigGateway from '../src/db/gateways/config'

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
