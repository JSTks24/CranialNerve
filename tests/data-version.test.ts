import { describe, expect, it, vi } from 'vitest'
import { subscribeDataChanged, notifyDataChanged, getDataVersion } from '../src/core/data-version'

describe('data-version 通知机制', () => {
  it('notifyDataChanged 递增版本并通知订阅者', () => {
    const cb = vi.fn()
    const unsub = subscribeDataChanged(cb)
    const before = getDataVersion()
    notifyDataChanged()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(getDataVersion()).toBe(before + 1)
    unsub()
  })

  it('退订后不再收到通知，重复退订安全', () => {
    const cb = vi.fn()
    const unsub = subscribeDataChanged(cb)
    unsub()
    unsub()
    notifyDataChanged()
    expect(cb).not.toHaveBeenCalled()
  })

  it('多个订阅者都收到通知，单个订阅者抛错不影响其余', () => {
    const a = vi.fn(() => { throw new Error('boom') })
    const b = vi.fn()
    const ua = subscribeDataChanged(a)
    const ub = subscribeDataChanged(b)
    notifyDataChanged()
    expect(b).toHaveBeenCalledTimes(1)
    ua()
    ub()
  })
})
