import { describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Store } from 'pinia'

vi.mock('@ui/toast', () => ({
  default: { success: () => {}, error: () => {}, warning: () => {}, info: () => {}, progress: () => {} },
}))

const { unsubCalled, subCalled, unsubDataCalled, subDataCalled } = vi.hoisted(() => ({
  unsubCalled: vi.fn(),
  subCalled: vi.fn(),
  unsubDataCalled: vi.fn(),
  subDataCalled: vi.fn(),
}))

vi.mock('@core/table/fill-orchestrator', () => ({
  subscribeFillState: () => {
    subCalled()
    return () => {
      unsubCalled()
    }
  },
  getFillState: () => ({ busy: false, runMode: null, progress: null }),
}))

vi.mock('@core/data-version', () => ({
  subscribeDataChanged: () => {
    subDataCalled()
    return () => {
      unsubDataCalled()
    }
  },
  getDataVersion: () => 0,
}))

import { useFillStatusStore } from '../src/ui/stores/fill-status'

describe('fill-status store 订阅清理（0.2 修复：面板关闭不再累积幽灵订阅）', () => {
  it('store 创建时注册订阅，$dispose 时取消订阅', () => {
    setActivePinia(createPinia())
    const store = useFillStatusStore()
    expect(subCalled).toHaveBeenCalledTimes(1)
    expect(subDataCalled).toHaveBeenCalledTimes(1)
    expect(unsubCalled).not.toHaveBeenCalled()
    expect(unsubDataCalled).not.toHaveBeenCalled()
    store.$dispose()
    expect(unsubCalled).toHaveBeenCalledTimes(1)
    expect(unsubDataCalled).toHaveBeenCalledTimes(1)
  })

  it('store 复用时只注册一次，$dispose 只取消一次', () => {
    setActivePinia(createPinia())
    unsubCalled.mockClear()
    subCalled.mockClear()
    unsubDataCalled.mockClear()
    subDataCalled.mockClear()
    const store = useFillStatusStore() as Store
    const store2 = useFillStatusStore()
    expect(store).toBe(store2)
    expect(subCalled).toHaveBeenCalledTimes(1)
    expect(subDataCalled).toHaveBeenCalledTimes(1)
    store.$dispose()
    expect(unsubCalled).toHaveBeenCalledTimes(1)
    expect(unsubDataCalled).toHaveBeenCalledTimes(1)
  })

  it('面板关闭（dispose）后再次打开，新 store 重新订阅，旧订阅已清理', () => {
    setActivePinia(createPinia())
    unsubCalled.mockClear()
    subCalled.mockClear()
    unsubDataCalled.mockClear()
    subDataCalled.mockClear()
    const store = useFillStatusStore()
    store.$dispose()
    const store2 = useFillStatusStore()
    expect(store).not.toBe(store2)
    expect(subCalled).toHaveBeenCalledTimes(2)
    expect(subDataCalled).toHaveBeenCalledTimes(2)
    expect(unsubCalled).toHaveBeenCalledTimes(1)
    expect(unsubDataCalled).toHaveBeenCalledTimes(1)
  })
})
