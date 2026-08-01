import { describe, expect, it } from 'vitest'
import { detectLastSummarizedAiFloor } from '../src/core/table/fill-orchestrator'
import createFrameRepo from '../src/db/sqlite/storage-frame-repo'
import { FRAME_FIELD_PREFIX } from '../src/shared/constants/msg-fields'
import type { ChatGateway } from '../src/db/gateways/chat'
import type { StorageFrame } from '../src/shared/types/storage-frame'
import type { CranialNerveSession } from '../src/core/session'

function makeFrame(withAiFill: boolean): StorageFrame {
  return {
    version: 2,
    logEntries: withAiFill
      ? [{ seq: 1, createdAt: 0, operations: [{ kind: 'sql_batch', statements: ['INSERT INTO t VALUES (1)'], reason: 'ai_fill' }] }]
      : [{ seq: 1, createdAt: 0, operations: [{ kind: 'sql_batch', statements: ['DELETE FROM t'], reason: 'manual_edit' }] }],
    checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: { tables: [] } },
  }
}

function makeSession(chat: FakeMessage[], frames: Record<number, boolean>): CranialNerveSession {
  for (const [idStr, withAiFill] of Object.entries(frames)) {
    const id = Number(idStr)
    ;(chat[id] as FakeMessage).extra = { [FRAME_FIELD_PREFIX]: JSON.stringify(makeFrame(withAiFill)) }
  }
  const gateway = {
    getChat: () => chat,
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra: () => {},
  } as unknown as ChatGateway
  const repo = createFrameRepo(gateway)
  return {
    getSyncBridgeRepo: () => repo,
    chat: { getChat: () => chat },
  } as unknown as CranialNerveSession
}

interface FakeMessage {
  is_user: boolean
  is_system: boolean
  mes: string
  extra: Record<string, unknown>
}

describe('detectLastSummarizedAiFloor', () => {
  it('返回最后一个含 ai_fill 的 AI 楼层', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'ai1', extra: {} },
      { is_user: false, is_system: false, mes: 'ai2', extra: {} },
      { is_user: false, is_system: false, mes: 'ai3', extra: {} },
    ]
    const session = makeSession(chat, { 1: true, 2: false, 3: true })
    expect(detectLastSummarizedAiFloor(session)).toBe(3)
  })

  it('只有 manual_edit 无 ai_fill 时返回 null', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'ai1', extra: {} },
    ]
    const session = makeSession(chat, { 1: false })
    expect(detectLastSummarizedAiFloor(session)).toBe(null)
  })

  it('无 repo 时返回 null', () => {
    const chat: FakeMessage[] = [{ is_user: true, is_system: false, mes: 'hi', extra: {} }]
    const session = {
      getSyncBridgeRepo: () => null,
      chat: { getChat: () => chat },
    } as unknown as CranialNerveSession
    expect(detectLastSummarizedAiFloor(session)).toBe(null)
  })
})
