import { describe, expect, it } from 'vitest'
import createFrameRepo from '../src/db/sqlite/storage-frame-repo'
import { replayFrames } from '../src/db/sqlite/frame-replay'
import { FRAME_FIELD_PREFIX } from '../src/shared/constants/msg-fields'
import type { ChatGateway } from '../src/db/gateways/chat'
import type { StorageFrame } from '../src/shared/types/storage-frame'
import type { DatabaseSnapshot } from '../src/shared/types/table'

function makeSnapshot(cellValue: string): DatabaseSnapshot {
  return {
    tables: [{
      name: 't',
      columns: [{ name: 'c', displayName: 'c', type: 'TEXT' }],
      rows: [{ c: cellValue }],
    }],
  }
}

function makeFrame(cellValue: string): StorageFrame {
  return {
    version: 2,
    logEntries: [],
    checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: makeSnapshot(cellValue) },
  }
}

interface FakeMessage {
  is_user: boolean
  mes: string
  extra: Record<string, unknown>
}

function makeChatGateway(initial: FakeMessage[]) {
  const chat: FakeMessage[] = initial
  const gateway = {
    getChat: () => chat,
    getLastUserMessageId: () => null,
    appendKeywordsToMessage: () => {},
    readChatMetadata: () => undefined,
    writeChatMetadata: () => {},
    readMessageExtra: (id: number, key: string) => {
      if (id < 0 || id >= chat.length) throw new Error(`message ${id} not found`)
      return chat[id]?.extra?.[key]
    },
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      if (id < 0 || id >= chat.length) throw new Error(`message ${id} not found`)
      const msg = chat[id]
      if (!msg) return
      if (!msg.extra) msg.extra = {}
      msg.extra[key] = value
    },
    saveChat: async () => {},
  } as unknown as ChatGateway
  return { gateway, chat }
}

describe('删除消息后帧访问不崩溃（1.3 修复：loadFrame/saveFrame 对越界防御）', () => {
  it('loadFrame 对越界 messageId 返回 null 而非 throw', () => {
    const { gateway } = makeChatGateway([
      { is_user: true, mes: 'u0', extra: {} },
      { is_user: false, mes: 'a1', extra: {} },
      { is_user: false, mes: 'a2', extra: {} },
    ])
    const repo = createFrameRepo(gateway)
    expect(repo.loadFrame(2)).toBeNull()
    expect(repo.loadFrame(-1)).toBeNull()
  })

  it('saveFrame 对越界 messageId 静默忽略', () => {
    const { gateway } = makeChatGateway([
      { is_user: true, mes: 'u0', extra: {} },
      { is_user: false, mes: 'a1', extra: {} },
    ])
    const repo = createFrameRepo(gateway)
    expect(() => repo.saveFrame(5, makeFrame('X'))).not.toThrow()
  })

  it('splice 删除中间消息后，数组缩短导致旧下标越界，loadFrame 返回 null 而非 throw', () => {
    const { gateway, chat } = makeChatGateway([
      { is_user: true, mes: 'u0', extra: {} },
      { is_user: false, mes: 'a1', extra: { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame('A')) } },
      { is_user: true, mes: 'u2', extra: {} },
      { is_user: false, mes: 'a3', extra: { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame('B')) } },
      { is_user: true, mes: 'u4', extra: {} },
    ])
    chat.splice(2, 1)
    const repo = createFrameRepo(gateway)
    expect(repo.loadFrame(4)).toBeNull()
    expect(() => repo.loadFrame(2)).not.toThrow()
  })

  it('删除消息后 replayFrames 不崩，仍能取到最近 checkpoint', () => {
    const { gateway, chat } = makeChatGateway([
      { is_user: true, mes: 'u0', extra: {} },
      { is_user: false, mes: 'a1', extra: { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame('A')) } },
      { is_user: true, mes: 'u2', extra: {} },
      { is_user: false, mes: 'a3', extra: { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame('B')) } },
      { is_user: true, mes: 'u4', extra: {} },
    ])
    chat.splice(1, 1)
    const repo = createFrameRepo(gateway)
    expect(() => replayFrames(repo)).not.toThrow()
    const replay = replayFrames(repo)
    expect(replay.snapshot).not.toBeNull()
  })

  it('未知版本帧被忽略并返回 null（修复④：不再把旧格式当新格式误读）', () => {
    const { gateway, chat } = makeChatGateway([
      { is_user: true, mes: 'u0', extra: {} },
      { is_user: false, mes: 'a1', extra: {} },
    ])
    chat[1]!.extra[FRAME_FIELD_PREFIX] = JSON.stringify({ version: 1, logEntries: [] })
    const repo = createFrameRepo(gateway)
    expect(repo.loadFrame(1)).toBeNull()
  })
})
