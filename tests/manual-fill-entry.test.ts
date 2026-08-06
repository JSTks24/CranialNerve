import { describe, expect, it, vi } from 'vitest'
import { CranialNerveSession } from '../src/core/session'
import type { ExecuteFillOptions } from '../src/core/table/fill-orchestrator'

vi.mock('@db/gateways/host-context', () => ({
  getHostContext: () => ({
    extensionSettings: {},
    characters: {},
    characterId: null,
    chatId: null,
    saveSettingsDebounced: () => {},
  }),
  getRequestHeaders: () => ({}),
}))
vi.mock('@db/gateways/host-state', () => ({
  getPersonaDescription: () => '',
  getCharDescription: () => '',
  getUserName: () => 'User',
}))

const { runManualFill, runManualCatchUp } = vi.hoisted(() => ({ runManualFill: vi.fn(), runManualCatchUp: vi.fn() }))

vi.mock('../src/core/table/fill-orchestrator', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/core/table/fill-orchestrator')>()
  return { ...mod, runManualFill, runManualCatchUp }
})

describe('手动填表入口 skipFloors 强制 0（不受配置跳过楼层影响）', () => {
  it('runManualRefill 传 skipFloors: 0 且清理目标表', async () => {
    const session = new CranialNerveSession()
    await session.runManualRefill({ targetTables: ['t'] })
    expect(runManualFill).toHaveBeenCalledWith(session, expect.objectContaining({
      skipFloors: 0,
      clearBeforeFill: true,
      clearTables: ['t'],
    }))
  })

  it('runManualChronicleFill 传 skipFloors: 0 且 runMode=chronicle', async () => {
    const session = new CranialNerveSession()
    await session.runManualChronicleFill({})
    expect(runManualFill).toHaveBeenCalledWith(session, expect.objectContaining({
      skipFloors: 0,
      runMode: 'chronicle',
    }))
  })

  it('调用方显式传 skipFloors 也会被覆盖为 0（手动填表不受配置跳过楼层影响）', async () => {
    const session = new CranialNerveSession()
    const opts: ExecuteFillOptions = { skipFloors: 2 }
    await session.runManualRefill(opts)
    expect(runManualFill).toHaveBeenCalledWith(session, expect.objectContaining({ skipFloors: 0 }))
  })

  it('runManualRefill 透传 merged runMode/fillCfgSource 且 suppressProgressNotifier 默认 true', async () => {
    const session = new CranialNerveSession()
    await session.runManualRefill({ targetTables: ['t'], runMode: 'merged', fillCfgSource: 'table' })
    expect(runManualFill).toHaveBeenCalledWith(session, expect.objectContaining({
      runMode: 'merged', fillCfgSource: 'table', suppressProgressNotifier: true, clearBeforeFill: true, skipFloors: 0,
    }))
  })

  it('runManualChronicleFill 透传 merged runMode（覆盖默认 chronicle）', async () => {
    const session = new CranialNerveSession()
    await session.runManualChronicleFill({ runMode: 'merged', fillCfgSource: 'chronicle' })
    expect(runManualFill).toHaveBeenCalledWith(session, expect.objectContaining({
      runMode: 'merged', fillCfgSource: 'chronicle', skipFloors: 0, suppressProgressNotifier: true,
    }))
  })

  it('runManualCatchUp 透传 merged runMode/fillCfgSource 且 suppressProgressNotifier 默认 true', async () => {
    const session = new CranialNerveSession()
    await session.runManualCatchUp({ runMode: 'merged', fillCfgSource: 'table' })
    expect(runManualCatchUp).toHaveBeenCalledWith(session, expect.objectContaining({
      runMode: 'merged', fillCfgSource: 'table', suppressProgressNotifier: true,
    }))
  })

  it('runManualChronicleCatchUp 透传 merged runMode（覆盖默认 chronicle）', async () => {
    const session = new CranialNerveSession()
    await session.runManualChronicleCatchUp({ runMode: 'merged', fillCfgSource: 'chronicle' })
    expect(runManualCatchUp).toHaveBeenCalledWith(session, expect.objectContaining({
      runMode: 'merged', fillCfgSource: 'chronicle', suppressProgressNotifier: true,
    }))
  })
})
