import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const { warningSpy, notifyCbs } = vi.hoisted(() => {
  const warningSpy = vi.fn()
  const notifyCbs: Array<(b: boolean, r: unknown, p: unknown) => void> = []
  return { warningSpy, notifyCbs }
})

vi.mock('@ui/toast', () => ({
  default: { success: () => {}, error: () => {}, warning: warningSpy, info: () => {}, progress: () => {} },
}))

vi.mock('@core/table/fill-orchestrator', () => ({
  subscribeFillState: (cb: (b: boolean, r: unknown, p: unknown) => void) => {
    notifyCbs.push(cb)
    return () => {
      const i = notifyCbs.indexOf(cb)
      if (i >= 0) notifyCbs.splice(i, 1)
    }
  },
  getFillState: () => ({ busy: false, runMode: null, progress: null }),
}))

import { useFillStatusStore } from '../src/ui/stores/fill-status'
import type { FillRunMode, FillProgressState } from '../src/core/table/fill-orchestrator'

function emit(busy: boolean, runMode: FillRunMode | null, progress: FillProgressState | null) {
  notifyCbs.forEach((cb) => cb(busy, runMode, progress))
}

describe('fill-status tokenWarn 去重（2.4 修复：同一轮填表只弹一次 token 超限警告）', () => {
  it('同轮填表内 tokenWarn 值变化也只在第一次弹 warning', async () => {
    setActivePinia(createPinia())
    notifyCbs.length = 0
    warningSpy.mockClear()
    useFillStatusStore()
    emit(true, 'table', {
      tick: 1, currentBucket: 1, totalBuckets: 3, tableFloor: null, chronicleFloor: null,
      tokenWarn: { estimatedTokens: 2000, maxTokens: 1000 },
    })
    await nextTick()
    expect(warningSpy).toHaveBeenCalledTimes(1)
    emit(true, 'table', {
      tick: 2, currentBucket: 2, totalBuckets: 3, tableFloor: null, chronicleFloor: null,
      tokenWarn: { estimatedTokens: 2400, maxTokens: 1000 },
    })
    await nextTick()
    expect(warningSpy).toHaveBeenCalledTimes(1)
  })

  it('新一轮填表开始后 tokenWarn 可再次提示', async () => {
    setActivePinia(createPinia())
    notifyCbs.length = 0
    warningSpy.mockClear()
    useFillStatusStore()
    emit(true, 'table', {
      tick: 1, currentBucket: 1, totalBuckets: 2, tableFloor: null, chronicleFloor: null,
      tokenWarn: { estimatedTokens: 2000, maxTokens: 1000 },
    })
    await nextTick()
    expect(warningSpy).toHaveBeenCalledTimes(1)
    emit(false, null, null)
    await nextTick()
    emit(true, 'table', {
      tick: 1, currentBucket: 1, totalBuckets: 2, tableFloor: null, chronicleFloor: null,
      tokenWarn: { estimatedTokens: 2200, maxTokens: 1000 },
    })
    await nextTick()
    expect(warningSpy).toHaveBeenCalledTimes(2)
  })

  it('tokenWarn 为 null（未超限）不弹 warning', async () => {
    setActivePinia(createPinia())
    notifyCbs.length = 0
    warningSpy.mockClear()
    useFillStatusStore()
    emit(true, 'table', {
      tick: 1, currentBucket: 1, totalBuckets: 2, tableFloor: null, chronicleFloor: null,
      tokenWarn: null,
    })
    await nextTick()
    expect(warningSpy).not.toHaveBeenCalled()
  })
})
