import { describe, expect, it, vi } from 'vitest'
import { clearChatData } from '../src/core/chat-reset'

function makeSession(overrides: Record<string, unknown> = {}) {
  const messages = [
    {
      is_user: true,
      mes: 'hi',
      extra: { CN_RECALL: '{"v":1}', CN_FRAME_: '{}', CN_DB_old: 'x', display_text: 'hi', other: 'keep1' }
    },
    {
      is_user: false,
      mes: 'resp',
      extra: { display_text: '手工文本', other: 'keep2' }
    },
    {
      is_user: false,
      mes: 'a',
      extra: { CN_FRAME_: '{}' }
    }
  ]
  const worldbook = {
    listWorldbookNames: vi.fn(() => ['CN_Data_token1', 'CN_Data_old', 'custom']),
    deleteWorldbook: vi.fn(async () => {}),
    detachFromChat: vi.fn(async () => {})
  }
  const chat = {
    getChat: vi.fn(() => messages),
    writeChatMetadata: vi.fn(),
    saveChat: vi.fn(async () => {})
  }
  return {
    chat,
    getChatToken: () => 'token1',
    worldbook,
    vectorIndexStore: { remove: vi.fn(async () => {}) },
    ...overrides
  }
}

describe('clearChatData', () => {
  it('删消息 CN_ 前缀键，有 CN_RECALL 的消息同删 display_text，其余键保留', async () => {
    const session = makeSession()
    await clearChatData(session as never)
    const first = session.chat.getChat()[0]!.extra as Record<string, unknown>
    expect(first.CN_RECALL).toBeUndefined()
    expect(first.CN_FRAME_).toBeUndefined()
    expect(first.CN_DB_old).toBeUndefined()
    expect(first.display_text).toBeUndefined()
    expect(first.other).toBe('keep1')
    const third = session.chat.getChat()[2]!.extra as Record<string, unknown>
    expect(third.CN_FRAME_).toBeUndefined()
  })

  it('无 CN_RECALL 的消息不误删 display_text', async () => {
    const session = makeSession()
    await clearChatData(session as never)
    const second = session.chat.getChat()[1]!.extra as Record<string, unknown>
    expect(second.display_text).toBe('手工文本')
    expect(second.other).toBe('keep2')
  })

  it('清 chatMetadata 的 CN_TEMPLATE 与 CN_FILL_PROGRESS', async () => {
    const session = makeSession()
    await clearChatData(session as never)
    expect(session.chat.writeChatMetadata).toHaveBeenCalledWith('CN_TEMPLATE', undefined)
    expect(session.chat.writeChatMetadata).toHaveBeenCalledWith('CN_FILL_PROGRESS', undefined)
  })

  it('删除所有 CN_Data_* 世界书并 detach，不碰非 CN 书', async () => {
    const session = makeSession()
    await clearChatData(session as never)
    expect(session.worldbook.deleteWorldbook).toHaveBeenCalledWith('CN_Data_token1')
    expect(session.worldbook.deleteWorldbook).toHaveBeenCalledWith('CN_Data_old')
    const deletedNames = (session.worldbook.deleteWorldbook.mock.calls as unknown as [string][]).map((c) => c[0])
    expect(deletedNames).not.toContain('custom')
    expect(session.worldbook.detachFromChat).toHaveBeenCalled()
  })

  it('删除向量索引文件并保存聊天', async () => {
    const session = makeSession()
    await clearChatData(session as never)
    expect(session.vectorIndexStore.remove).toHaveBeenCalledWith('token1')
    expect(session.chat.saveChat).toHaveBeenCalled()
  })
})
