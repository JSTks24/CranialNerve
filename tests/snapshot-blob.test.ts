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

describe('BLOB 快照往返（修复②：二进制数据不再损坏）', () => {
  it('快照 rows 里 BLOB 值转为 base64 字符串而非对象', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (id INTEGER, data BLOB)')
    const blob = new Uint8Array([1, 2, 3, 250, 251, 0, 255])
    core.run('INSERT INTO t VALUES (1, ?)', [blob])
    const snapshot = buildSnapshotFromCore(core)
    const dataVal = snapshot.tables[0]!.rows[0]!.data
    expect(typeof dataVal).toBe('string')
    expect(dataVal).toBe(btoa(String.fromCharCode(...blob)))
    core.dispose()
  })

  it('快照往返后 BLOB 数据完整恢复为 Uint8Array', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (id INTEGER, data BLOB)')
    const blob = new Uint8Array([1, 2, 3, 250, 251, 0, 255, 128])
    core.run('INSERT INTO t VALUES (1, ?)', [blob])
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
    const result = core2.exec('SELECT data FROM t')
    const restored = result[0]!.rows[0]!.data as Uint8Array
    expect(restored).toBeInstanceOf(Uint8Array)
    expect(Array.from(restored)).toEqual(Array.from(blob))
    core.dispose()
    core2.dispose()
  })

  it('BLOB 列文本值也能完整往返', async () => {
    const core = new SqliteCore()
    await core.init()
    core.run('CREATE TABLE t (id INTEGER, data BLOB)')
    const text = 'plain text in blob column'
    core.run('INSERT INTO t VALUES (1, ?)', [new TextEncoder().encode(text)])
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
    const result = core2.exec('SELECT data FROM t')
    const restored = result[0]!.rows[0]!.data as Uint8Array
    expect(new TextDecoder().decode(restored)).toBe(text)
    core.dispose()
    core2.dispose()
  })
})
