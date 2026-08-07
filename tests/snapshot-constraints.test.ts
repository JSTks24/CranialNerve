import { describe, expect, it } from 'vitest'
import SqliteCore from '../src/db/sqlite/core'
import { buildSnapshotFromCore } from '../src/db/sqlite/snapshot-builder'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
import { FRAME_FIELD_PREFIX } from '../src/shared/constants/msg-fields'
import type { ChatGateway } from '../src/db/gateways/chat'
import type { StorageFrame } from '../src/shared/types/storage-frame'

function makeChatGateway() {
  const chat: Array<{ is_user: boolean; mes: string; extra: Record<string, unknown> }> = [
    { is_user: true, mes: 'u', extra: {} },
    { is_user: false, mes: 'a', extra: {} },
  ]
  return {
    getChat: () => chat,
    getLastUserMessageId: () => null,
    appendKeywordsToMessage: () => {},
    readChatMetadata: () => undefined,
    writeChatMetadata: () => {},
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      const m = chat[id]
      if (!m) return
      if (!m.extra) m.extra = {}
      m.extra[key] = value
    },
    saveChat: async () => {},
  } as unknown as ChatGateway
}

describe('快照往返保留约束（修复①：NOT NULL / DEFAULT / UNIQUE 不再丢失）', () => {
  it('getTableColumns 正确读取 NOT NULL / DEFAULT / UNIQUE', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE, age INTEGER DEFAULT 18)')
    const cols = core.getTableColumns('t')
    const name = cols.find((c) => c.name === 'name')!
    const code = cols.find((c) => c.name === 'code')!
    const age = cols.find((c) => c.name === 'age')!
    expect(name.constraints?.nullable).toBe(false)
    expect(code.constraints?.unique).toBe(true)
    expect(age.constraints?.defaultValue).toBe('18')
    core.dispose()
  })

  it('快照往返后约束保留，重建表仍强制 NOT NULL / UNIQUE / DEFAULT', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE, age INTEGER DEFAULT 18)')
    const snapshot = buildSnapshotFromCore(core)
    const gateway = makeChatGateway()
    const frame: StorageFrame = {
      version: 2,
      logEntries: [],
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: snapshot },
    }
    const chat = gateway.getChat() as Array<{ is_user: boolean; mes: string; extra: Record<string, unknown> }>
    chat[1]!.extra = { [FRAME_FIELD_PREFIX]: JSON.stringify(frame) }
    const core2 = new SqliteCore()
    await core2.init()
    const bridge = new SqliteSyncBridge(core2, gateway)
    bridge.load()
    const cols = core2.getTableColumns('t')
    const name = cols.find((c) => c.name === 'name')!
    const code = cols.find((c) => c.name === 'code')!
    const age = cols.find((c) => c.name === 'age')!
    expect(name.constraints?.nullable).toBe(false)
    expect(code.constraints?.unique).toBe(true)
    expect(age.constraints?.defaultValue).toBe('18')
    core.dispose()
    core2.dispose()
  })

  it('快照往返后 NOT NULL 约束真实生效（空值被拒绝）', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    const snapshot = buildSnapshotFromCore(core)
    const gateway = makeChatGateway()
    const frame: StorageFrame = {
      version: 2,
      logEntries: [],
      checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: snapshot },
    }
    const chat = gateway.getChat() as Array<{ is_user: boolean; mes: string; extra: Record<string, unknown> }>
    chat[1]!.extra = { [FRAME_FIELD_PREFIX]: JSON.stringify(frame) }
    const core2 = new SqliteCore()
    await core2.init()
    const bridge = new SqliteSyncBridge(core2, gateway)
    bridge.load()
    expect(() => core2.run("INSERT INTO t (name) VALUES (NULL)")).toThrow()
    core.dispose()
    core2.dispose()
  })
})
