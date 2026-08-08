import { describe, expect, it } from 'vitest'
import {
  extractChronicleSeq,
  formatChronicleKey,
  readKeymap,
  resolveFloorSeq,
  migrateChronicleKeymap,
} from '../src/core/table/chronicle-keymap'
import { rewriteChronicleInsert } from '../src/core/table/sql-executor'
import createFrameRepo from '../src/db/sqlite/storage-frame-repo'
import { FRAME_FIELD_PREFIX } from '../src/shared/constants/msg-fields'
import type { ChatGateway } from '../src/db/gateways/chat'
import type { StorageFrame, SqlBatchOperation } from '../src/shared/types/storage-frame'
import type { CranialNerveSession } from '../src/core/session'

type FrameReason = SqlBatchOperation['reason'] | SqlBatchOperation['reason'][]

interface FrameSpec {
  reason: FrameReason
  sql?: string
}

function makeFrame(reason: FrameReason, sql = 'INSERT INTO t VALUES (1)'): StorageFrame {
  const reasons = Array.isArray(reason) ? reason : [reason]
  return {
    version: 2,
    logEntries: [
      {
        seq: 1,
        createdAt: 0,
        operations: reasons.map((r) => ({ kind: 'sql_batch', statements: [sql], reason: r })),
      },
    ],
    checkpoint: { kind: 'full', createdAt: 0, reason: 'init', data: { tables: [] } },
  }
}

interface FakeMessage {
  is_user: boolean
  is_system: boolean
  mes: string
  extra: Record<string, unknown>
}

function makeSession(
  chat: FakeMessage[],
  frames: Record<number, FrameReason | FrameSpec>,
  meta: Record<string, unknown>
): CranialNerveSession {
  for (const [idStr, spec] of Object.entries(frames)) {
    const id = Number(idStr)
    const frame =
      typeof spec === 'string' || Array.isArray(spec)
        ? makeFrame(spec as FrameReason)
        : makeFrame((spec as FrameSpec).reason, (spec as FrameSpec).sql)
    ;(chat[id] as FakeMessage).extra = { [FRAME_FIELD_PREFIX]: JSON.stringify(frame) }
  }
  const gateway = {
    getChat: () => chat,
    readMessageExtra: (id: number, key: string) => chat[id]?.extra?.[key],
    writeMessageExtra: (id: number, key: string, value: unknown) => {
      const m = chat[id]
      if (!m) return
      if (!m.extra) m.extra = {}
      m.extra[key] = value
    },
    readChatMetadata: (key: string) => meta[key],
    writeChatMetadata: (key: string, value: unknown) => {
      meta[key] = value
    },
  } as unknown as ChatGateway
  const repo = createFrameRepo(gateway)
  return {
    getSyncBridgeRepo: () => repo,
    chat: {
      getChat: () => chat,
      readChatMetadata: (key: string) => meta[key],
      writeChatMetadata: (key: string, value: unknown) => {
        meta[key] = value
      },
    },
  } as unknown as CranialNerveSession
}

describe('extractChronicleSeq / formatChronicleKey', () => {
  it('提取 CN 序号', () => {
    expect(extractChronicleSeq("INSERT INTO cn_chronicle (key) VALUES ('CN0005')")).toBe(5)
  })
  it('无匹配返回 null', () => {
    expect(extractChronicleSeq('INSERT INTO t VALUES (1)')).toBeNull()
  })
  it('格式化 key 4 位零填充', () => {
    expect(formatChronicleKey(5)).toBe('CN0005')
    expect(formatChronicleKey(42)).toBe('CN0042')
  })
})

describe('resolveFloorSeq', () => {
  it('首次分配递增序号并持久化到映射', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
    ]
    const meta: Record<string, unknown> = {}
    const session = makeSession(chat, {}, meta)
    expect(resolveFloorSeq(session, 1)).toBe(1)
    expect(resolveFloorSeq(session, 3)).toBe(2)
    expect(readKeymap(session)).toEqual({ 1: 1, 3: 2 })
  })

  it('重填复用已分配序号', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    const meta: Record<string, unknown> = {}
    const session = makeSession(chat, {}, meta)
    expect(resolveFloorSeq(session, 1)).toBe(1)
    expect(resolveFloorSeq(session, 1)).toBe(1)
  })

  it('无映射时从该层帧推导历史序号并写回', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    const meta: Record<string, unknown> = {}
    const session = makeSession(chat, { 1: { reason: 'ai_fill_chronicle', sql: "INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0003', 'x')" } }, meta)
    expect(resolveFloorSeq(session, 1)).toBe(3)
    expect(readKeymap(session)).toEqual({ 1: 3 })
  })

  it('新楼层序号在历史最大基础上递增', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
    ]
    const meta: Record<string, unknown> = {}
    const session = makeSession(
      chat,
      { 1: { reason: 'ai_fill_chronicle', sql: "INSERT INTO cn_chronicle (key) VALUES ('CN0007')" } },
      meta
    )
    expect(resolveFloorSeq(session, 3)).toBe(8)
  })
})

describe('migrateChronicleKeymap', () => {
  it('扫描全楼层帧为有纪要的楼层建映射', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
      { is_user: true, is_system: false, mes: 'u2', extra: {} },
      { is_user: false, is_system: false, mes: 'a3', extra: {} },
    ]
    const meta: Record<string, unknown> = {}
    const session = makeSession(chat, {
      1: { reason: 'ai_fill_chronicle', sql: "INSERT INTO cn_chronicle (key) VALUES ('CN0001')" },
      3: { reason: ['ai_fill_table', 'ai_fill_chronicle'], sql: "INSERT INTO cn_chronicle (key) VALUES ('CN0002')" },
    }, meta)
    migrateChronicleKeymap(session)
    expect(readKeymap(session)).toEqual({ 1: 1, 3: 2 })
  })

  it('幂等：二次迁移不覆盖已有映射', () => {
    const chat: FakeMessage[] = [
      { is_user: true, is_system: false, mes: 'u0', extra: {} },
      { is_user: false, is_system: false, mes: 'a1', extra: {} },
    ]
    const meta: Record<string, unknown> = {}
    const session = makeSession(chat, { 1: { reason: 'ai_fill_chronicle', sql: "INSERT INTO cn_chronicle (key) VALUES ('CN0001')" } }, meta)
    migrateChronicleKeymap(session)
    migrateChronicleKeymap(session)
    expect(readKeymap(session)).toEqual({ 1: 1 })
  })
})

describe('rewriteChronicleInsert', () => {
  it('把 INSERT 的 key 替换为绑定序号并转 REPLACE', () => {
    const sql = "INSERT INTO cn_chronicle (key, time_start, location, chronicle_text) VALUES ('CN0009', '2024-01-01', '王都', '剧情纪要')"
    expect(rewriteChronicleInsert(sql, 3)).toBe(
      "REPLACE INTO cn_chronicle (key, time_start, location, chronicle_text) VALUES ('CN0003', '2024-01-01', '王都', '剧情纪要')"
    )
  })

  it('值含逗号/括号/换行不被误切', () => {
    const sql = "INSERT INTO cn_chronicle (key, chronicle_text, important_word) VALUES ('CN0001', '事件 a, b (详细)', '人物: 艾琳\\n组织: 无')"
    const out = rewriteChronicleInsert(sql, 2)!
    expect(out).toContain("'CN0002'")
    expect(out).toContain("'事件 a, b (详细)'")
    expect(out).toContain("'人物: 艾琳\\n组织: 无'")
  })

  it('多语句只改写 cn_chronicle 那一条', () => {
    const sql = "UPDATE t SET c = 1 WHERE id = 2; INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0005', 'x')"
    const out = rewriteChronicleInsert(sql, 7)!
    expect(out).toContain('UPDATE t SET c = 1 WHERE id = 2')
    expect(out).toContain("REPLACE INTO cn_chronicle")
    expect(out).toContain("'CN0007'")
  })

  it('已 REPLACE 的语句只换 key', () => {
    const sql = "REPLACE INTO cn_chronicle (key, chronicle_text) VALUES ('CN0005', 'x')"
    const out = rewriteChronicleInsert(sql, 9)!
    expect(out).toContain('REPLACE INTO cn_chronicle')
    expect(out).toContain("'CN0009'")
  })

  it('缺 key 列返回 null', () => {
    const sql = "INSERT INTO cn_chronicle (chronicle_text) VALUES ('x')"
    expect(rewriteChronicleInsert(sql, 1)).toBeNull()
  })

  it('无列名（无法解析）返回 null', () => {
    const sql = "INSERT INTO cn_chronicle VALUES ('CN0001', 'x')"
    expect(rewriteChronicleInsert(sql, 1)).toBeNull()
  })

  it('非 cn_chronicle 语句返回 null', () => {
    const sql = "INSERT INTO t (c) VALUES ('x')"
    expect(rewriteChronicleInsert(sql, 1)).toBeNull()
  })
})
