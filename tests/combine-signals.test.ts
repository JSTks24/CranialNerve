import { describe, expect, it } from 'vitest'
import { combineSignals } from '../src/core/table/fill-orchestrator'

describe('combineSignals（3.2 修复：会话级中断信号与用户终止信号合并）', () => {
  it('无信号时返回 undefined', () => {
    expect(combineSignals()).toBeUndefined()
    expect(combineSignals(undefined, undefined)).toBeUndefined()
  })

  it('单个信号原样返回', () => {
    const a = new AbortController()
    expect(combineSignals(a.signal)).toBe(a.signal)
  })

  it('任一输入信号 abort 后合并信号 abort', () => {
    const a = new AbortController()
    const b = new AbortController()
    const merged = combineSignals(a.signal, b.signal)
    expect(merged!.aborted).toBe(false)
    a.abort()
    expect(merged!.aborted).toBe(true)
  })

  it('输入信号已 abort 时合并信号立即 abort', () => {
    const a = new AbortController()
    a.abort()
    const merged = combineSignals(a.signal, new AbortController().signal)
    expect(merged!.aborted).toBe(true)
  })

  it('第二个信号 abort 也能传播', () => {
    const a = new AbortController()
    const b = new AbortController()
    const merged = combineSignals(a.signal, b.signal)
    b.abort()
    expect(merged!.aborted).toBe(true)
  })
})
