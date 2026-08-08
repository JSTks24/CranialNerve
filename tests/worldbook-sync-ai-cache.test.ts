import { describe, expect, it, vi } from 'vitest'
import type { TableDef } from '../src/shared/types/table'
import { syncToWorldbook } from '../src/core/worldbook-sync'
import { computeTableFingerprint, keywordsFieldName } from '../src/core/keyword-cache'

const T1_DEF: TableDef = {
  name: 't1',
  displayName: '测试表',
  columns: [
    { name: 'name', displayName: '姓名', type: 'TEXT', constraints: { primaryKey: true } },
    { name: 'desc', displayName: '描述', type: 'TEXT' }
  ],
  exportConfig: {
    enabled: true,
    entryType: 'keyword',
    keywordMode: 'ai_prompt',
    keywordColumn: ''
  }
}

const T1_COLUMNS = ['__rowid__', 'name', 'desc']

function makeChat(n: number) {
  const messages: Array<{ extra?: Record<string, unknown>; mes?: string }> = []
  for (let i = 0; i < n; i++) {
    messages.push({ mes: `m${i}` })
  }
  return {
    messages,
    chat: {
      getChat: () => messages,
      readMessageExtra: (id: number, key: string) => messages[id]?.extra?.[key],
      writeMessageExtra: (id: number, key: string, value: unknown) => {
        if (id < 0 || id >= messages.length) {
          throw new Error(`message ${id} not found`)
        }
        if (!messages[id]!.extra) {
          messages[id]!.extra = {}
        }
        messages[id]!.extra![key] = value
      }
    }
  }
}

function makeSession(
  rows: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {}
) {
  const { chat, messages } = makeChat(1)
  const worldbook = {
    listWorldbookNames: vi.fn(() => []),
    createWorldbook: vi.fn(async () => {}),
    loadLorebook: vi.fn(async () => ({ entries: {} })),
    saveLorebook: vi.fn(async () => {}),
    isAttachedToChat: vi.fn(() => false),
    attachToChat: vi.fn(async () => {})
  }
  const session = {
    getChatToken: () => 'token1',
    chat,
    worldbook,
    getChronicleTableDef: () => ({ name: 'cn_chronicle', columns: [] }),
    listTables: vi.fn(() => ['t1']),
    getTableRowsWithRowid: vi.fn(() => [{ columns: T1_COLUMNS, rows }]),
    getTableDef: vi.fn(() => T1_DEF),
    generateKeywordsForRows: vi.fn(async () => rows.map((r) => [`${String(r.name)}key`])),
    ...overrides
  }
  return { session, messages }
}

function getSavedEntries(session: { worldbook: { saveLorebook: ReturnType<typeof vi.fn> } }) {
  const calls = session.worldbook.saveLorebook.mock.calls as unknown as Array<
    [unknown, { entries: Record<number, { key: string[]; content: string; constant: boolean }> }]
  >
  return calls[0]![1].entries
}

function writeCache(messages: Array<{ extra?: Record<string, unknown> }>, rows: Array<Record<string, unknown>>) {
  const rowsMap: Record<string, { k: string[]; f: string; id?: string }> = {}
  for (const row of rows) {
    rowsMap[String(row.__rowid__)] = {
      k: [`${String(row.name)}key`],
      f: `fp-${String(row.name)}`,
      id: String(row.name)
    }
  }
  messages[0]!.extra = {
    [keywordsFieldName('t1')]: JSON.stringify({ v: 1, tf: computeTableFingerprint(T1_DEF, T1_COLUMNS), rows: rowsMap })
  }
}

describe('syncToWorldbook ai_prompt 关键词缓存', () => {
  it('首次同步:调 AI 恰一次并写缓存', async () => {
    const rows = [
      { __rowid__: 1, name: '甲', desc: 'd1' },
      { __rowid__: 2, name: '乙', desc: 'd2' }
    ]
    const { session, messages } = makeSession(rows)
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForRows).toHaveBeenCalledTimes(1)
    expect(messages[0]!.extra![keywordsFieldName('t1')]).toBeTruthy()
    const entries = Object.values(getSavedEntries(session))
    expect(entries.length).toBe(2)
  })

  it('二次同步同数据:零 AI 调用且条目正常', async () => {
    const rows = [
      { __rowid__: 1, name: '甲', desc: 'd1' },
      { __rowid__: 2, name: '乙', desc: 'd2' }
    ]
    const { session, messages } = makeSession(rows)
    writeCache(messages, rows)
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForRows).not.toHaveBeenCalled()
    const entries = Object.values(getSavedEntries(session))
    expect(entries.length).toBe(2)
    expect(entries.some((e) => e.key.includes('甲key'))).toBe(true)
  })

  it('删除一行:零 AI 调用', async () => {
    const cachedRows = [
      { __rowid__: 1, name: '甲', desc: 'd1' },
      { __rowid__: 2, name: '乙', desc: 'd2' }
    ]
    const { session, messages } = makeSession([{ __rowid__: 1, name: '甲', desc: 'd1' }])
    writeCache(messages, cachedRows)
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForRows).not.toHaveBeenCalled()
    const entries = Object.values(getSavedEntries(session))
    expect(entries.length).toBe(1)
  })

  it('编辑一行内容但 id 不变:零 AI 调用', async () => {
    const cachedRows = [{ __rowid__: 1, name: '甲', desc: '旧描述' }]
    const { session, messages } = makeSession([{ __rowid__: 1, name: '甲', desc: '新描述' }])
    writeCache(messages, cachedRows)
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForRows).not.toHaveBeenCalled()
    const entries = Object.values(getSavedEntries(session))
    expect(entries.length).toBe(1)
    expect(entries[0]!.key).toEqual(['甲key'])
  })

  it('插入一行:恰一次 AI 调用且缓存全量覆盖', async () => {
    const cachedRows = [{ __rowid__: 1, name: '甲', desc: 'd1' }]
    const { session, messages } = makeSession([
      { __rowid__: 1, name: '甲', desc: 'd1' },
      { __rowid__: 2, name: '乙', desc: 'd2' }
    ])
    writeCache(messages, cachedRows)
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForRows).toHaveBeenCalledTimes(1)
    const cache = JSON.parse(messages[0]!.extra![keywordsFieldName('t1')] as string)
    expect(Object.keys(cache.rows)).toHaveLength(2)
  })

  it('rowid 复用但 id 不同:判缺并重生成', async () => {
    const cachedRows = [{ __rowid__: 1, name: '甲', desc: 'd1' }]
    const { session, messages } = makeSession([{ __rowid__: 1, name: '丙', desc: 'd3' }])
    writeCache(messages, cachedRows)
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForRows).toHaveBeenCalledTimes(1)
    const entries = Object.values(getSavedEntries(session))
    expect(entries.length).toBe(1)
    expect(entries[0]!.key).toEqual(['丙key'])
  })

  it('表指纹变化(提示词改了):重新生成', async () => {
    const rows = [{ __rowid__: 1, name: '甲', desc: 'd1' }]
    const { session, messages } = makeSession(rows)
    messages[0]!.extra = {
      [keywordsFieldName('t1')]: JSON.stringify({
        v: 1,
        tf: 'old-fp',
        rows: { 1: { k: ['甲key'], f: 'x', id: '甲' } }
      })
    }
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForRows).toHaveBeenCalledTimes(1)
  })

  it('AI 失败:降级复用匹配行缓存,不 throw,无缓存行走空', async () => {
    const cachedRows = [{ __rowid__: 1, name: '甲', desc: 'd1' }]
    const { session, messages } = makeSession([
      { __rowid__: 1, name: '甲', desc: 'd1' },
      { __rowid__: 2, name: '乙', desc: 'd2' }
    ])
    writeCache(messages, cachedRows)
    session.generateKeywordsForRows = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(syncToWorldbook(session as never)).resolves.not.toThrow()
    const entries = Object.values(getSavedEntries(session))
    expect(entries.length).toBe(1)
    expect(entries[0]!.key).toEqual(['甲key'])
  })

  it('已 attach 时 attachToChat 不重复调用', async () => {
    const rows = [{ __rowid__: 1, name: '甲', desc: 'd1' }]
    const { session, messages } = makeSession(rows)
    writeCache(messages, rows)
    session.worldbook.isAttachedToChat = vi.fn(() => true)
    await syncToWorldbook(session as never)
    expect(session.worldbook.attachToChat).not.toHaveBeenCalled()
  })

  it('未 attach 时 attachToChat 调用一次', async () => {
    const rows = [{ __rowid__: 1, name: '甲', desc: 'd1' }]
    const { session, messages } = makeSession(rows)
    writeCache(messages, rows)
    await syncToWorldbook(session as never)
    expect(session.worldbook.attachToChat).toHaveBeenCalledTimes(1)
  })

  it('AI 输出空关键词行:照常缓存,但不出世界书条目', async () => {
    const rows = [
      { __rowid__: 1, name: '甲', desc: 'd1' },
      { __rowid__: 2, name: '乙', desc: 'd2' }
    ]
    const { session, messages } = makeSession(rows, {
      generateKeywordsForRows: vi.fn(async () => [['甲key'], []])
    })
    await syncToWorldbook(session as never)
    const entries = Object.values(getSavedEntries(session))
    expect(entries.length).toBe(1)
    const cache = JSON.parse(messages[0]!.extra![keywordsFieldName('t1')] as string)
    expect(cache.rows['2'].k).toEqual([])
  })
})
