import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushChatSave, scheduleChatSave } from '../src/core/chat-save'

function makeSession(saveChat: ReturnType<typeof vi.fn> = vi.fn(async () => {})) {
  return {
    chat: { saveChat },
    runWrite: vi.fn(async (task: () => unknown) => task())
  }
}

describe('chat-save 防抖', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('连续 schedule 多次只落盘一次', async () => {
    const saveChat = vi.fn(async () => {})
    const session = makeSession(saveChat)
    scheduleChatSave(session as never)
    scheduleChatSave(session as never)
    scheduleChatSave(session as never)
    expect(saveChat).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    expect(saveChat).toHaveBeenCalledTimes(1)
  })

  it('500ms 内再次 schedule 重置计时', async () => {
    const saveChat = vi.fn(async () => {})
    const session = makeSession(saveChat)
    scheduleChatSave(session as never)
    await vi.advanceTimersByTimeAsync(300)
    scheduleChatSave(session as never)
    await vi.advanceTimersByTimeAsync(300)
    expect(saveChat).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(saveChat).toHaveBeenCalledTimes(1)
  })

  it('flush 立即保存并取消 pending 定时器', async () => {
    const saveChat = vi.fn(async () => {})
    const session = makeSession(saveChat)
    scheduleChatSave(session as never)
    await flushChatSave(session as never)
    expect(saveChat).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(saveChat).toHaveBeenCalledTimes(1)
  })

  it('无 pending 时 flush 也立即保存一次', async () => {
    const saveChat = vi.fn(async () => {})
    const session = makeSession(saveChat)
    await flushChatSave(session as never)
    expect(saveChat).toHaveBeenCalledTimes(1)
  })

  it('saveChat 失败时经 runWrite 吞错不 throw', async () => {
    const saveChat = vi.fn(async () => {
      throw new Error('boom')
    })
    const session = makeSession(saveChat)
    scheduleChatSave(session as never)
    await expect(vi.advanceTimersByTimeAsync(600)).resolves.not.toThrow()
    expect(saveChat).toHaveBeenCalledTimes(1)
  })
})
