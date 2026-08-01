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

function makeChatGateway(): { gateway: ChatGateway; chat: FakeMessage[] } {
  const chat: FakeMessage[] = [
    { is_user: true, mes: 'hi', extra: {} },
    { is_user: false, mes: 'ai1', extra: { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame('A')) } },
    { is_user: false, mes: 'ai2', extra: { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame('B')) } },
  ]
  const gateway = {
    getChat: () => chat,
    getLastUserMessageId: () => null,
    appendKeywordsToMessage: () => {},
    readChatMetadata: () => undefined,
    writeChatMetadata: () => {},
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      const msg = chat[id]
      if (!msg) return
      if (!msg.extra) msg.extra = {}
      msg.extra[key] = value
    },
    saveChat: async () => {},
  } as unknown as ChatGateway
  return { gateway, chat }
}

describe('regenerate 清旧帧 + replay 回退', () => {
  it('removeFrame 前最近 frame 是末层', () => {
    const { gateway } = makeChatGateway()
    const repo = createFrameRepo(gateway)
    expect(repo.findLatestFrameMessageId()).toBe(2)
  })

  it('removeFrame 末层后 replay 回退到上一层 checkpoint', () => {
    const { gateway } = makeChatGateway()
    const repo = createFrameRepo(gateway)
    repo.removeFrame(2)
    expect(repo.findLatestFrameMessageId()).toBe(1)
    const replay = replayFrames(repo)
    expect(replay.snapshotIndex).toBe(1)
    expect(replay.snapshot).not.toBeNull()
    expect(replay.snapshot!.tables[0]!.rows[0]!.c).toBe('A')
  })

  it('removeFrame 后末层 extra 的 frame 字段被删除', () => {
    const { gateway, chat } = makeChatGateway()
    const repo = createFrameRepo(gateway)
    repo.removeFrame(2)
    expect(FRAME_FIELD_PREFIX in chat[2]!.extra).toBe(false)
  })

  it('removeFrame 不存在的 messageId 无害', () => {
    const { gateway } = makeChatGateway()
    const repo = createFrameRepo(gateway)
    repo.removeFrame(99)
    expect(repo.findLatestFrameMessageId()).toBe(2)
  })

  it('removeFrame 清掉所有 frame 后 replay 返回 null snapshot', () => {
    const { gateway } = makeChatGateway()
    const repo = createFrameRepo(gateway)
    repo.removeFrame(2)
    repo.removeFrame(1)
    expect(repo.findLatestFrameMessageId()).toBeNull()
    const replay = replayFrames(repo)
    expect(replay.snapshot).toBeNull()
    expect(replay.snapshotIndex).toBeNull()
  })
})
