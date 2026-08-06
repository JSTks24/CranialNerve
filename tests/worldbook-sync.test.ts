import { describe, expect, it, vi } from 'vitest'
import { syncToWorldbook } from '../src/core/worldbook-sync'

function makeSession(overrides: Record<string, unknown> = {}) {
  const worldbook = {
    listWorldbookNames: vi.fn(() => []),
    createWorldbook: vi.fn(async () => {}),
    loadLorebook: vi.fn(async () => ({ entries: {} })),
    saveLorebook: vi.fn(async () => {}),
    attachToChat: vi.fn(async () => {})
  }
  const chronicleDef = {
    name: 'cn_chronicle',
    columns: [
      { name: 'key', displayName: '编码', type: 'TEXT', note: 'x' },
      { name: 'chronicle_text', displayName: '纪要正文', type: 'TEXT', note: 'x' }
    ]
  }
  return {
    getChatToken: () => 'token1',
    worldbook,
    getChronicleTableDef: () => chronicleDef,
    listTables: vi.fn(() => ['t1']),
    getTableRowsWithRowid: vi.fn(() => [
      {
        columns: ['row_id', 'name', 'desc'],
        rows: [
          { name: '甲', desc: 'd1' },
          { name: '乙', desc: 'd2' }
        ]
      }
    ]),
    getTableDef: vi.fn(() => ({
      name: 't1',
      exportConfig: {
        enabled: true,
        entryType: 'keyword',
        keywordMode: 'custom',
        keywordColumn: 'name'
      }
    })),
    generateKeywordsForRows: vi.fn(async () => [['甲key'], ['乙key']]),
    ...overrides
  }
}

function getSavedEntries(
  session: ReturnType<typeof makeSession>
): Record<number, { key: string[]; content: string; constant: boolean }> {
  const calls = session.worldbook.saveLorebook.mock.calls as unknown as Array<
    [unknown, { entries: Record<number, { key: string[]; content: string; constant: boolean }> }]
  >
  expect(calls.length).toBeGreaterThan(0)
  return calls[0]![1].entries
}

describe('syncToWorldbook keyword 按行拆分', () => {
  it('custom 每行一个条目，用 keywordColumn 列值作 key，不调 AI', async () => {
    const session = makeSession()
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForRows).not.toHaveBeenCalled()
    const entries = Object.values(getSavedEntries(session))
    expect(entries.length).toBe(2)
    const jia = entries.find((e) => e.key.includes('甲'))
    const yi = entries.find((e) => e.key.includes('乙'))
    expect(jia).toBeTruthy()
    expect(jia!.key).toEqual(['甲'])
    expect(yi).toBeTruthy()
    expect(yi!.key).toEqual(['乙'])
  })

  it('ai_prompt 只调一次 generateKeywordsForRows(tableName)，每行一个条目', async () => {
    const session = makeSession({
      getTableDef: vi.fn(() => ({
        name: 't1',
        exportConfig: {
          enabled: true,
          entryType: 'keyword',
          keywordMode: 'ai_prompt',
          keywordColumn: ''
        }
      }))
    })
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForRows).toHaveBeenCalledWith('t1')
    expect(session.generateKeywordsForRows).toHaveBeenCalledTimes(1)
    const entries = Object.values(getSavedEntries(session))
    expect(entries.length).toBe(2)
    expect(entries.find((e) => e.key.includes('甲key'))).toBeTruthy()
    expect(entries.find((e) => e.key.includes('乙key'))).toBeTruthy()
  })

  it('custom 无 keywordColumn 跳过该表', async () => {
    const session = makeSession({
      getTableDef: vi.fn(() => ({
        name: 't1',
        exportConfig: {
          enabled: true,
          entryType: 'keyword',
          keywordMode: 'custom',
          keywordColumn: ''
        }
      }))
    })
    await syncToWorldbook(session as never)
    const calls = session.worldbook.saveLorebook.mock.calls as unknown as Array<
      [unknown, { entries: Record<number, unknown> }]
    >
    const entries = calls[0]![1].entries
    expect(Object.keys(entries)).toHaveLength(0)
  })
})

describe('syncToWorldbook constant', () => {
  it('constant 整表一个条目', async () => {
    const session = makeSession({
      getTableDef: vi.fn(() => ({
        name: 't1',
        exportConfig: {
          enabled: true,
          entryType: 'constant',
          keywordColumn: ''
        }
      }))
    })
    await syncToWorldbook(session as never)
    const entries = Object.values(getSavedEntries(session))
    expect(entries.length).toBe(1)
    expect(entries[0]!.key).toEqual(['t1'])
    expect(entries[0]!.constant).toBe(true)
  })
})

describe('syncToWorldbook 注入位置 role 映射', () => {
  it('at_depth_as_user -> role=1', async () => {
    const session = makeSession({
      getTableDef: vi.fn(() => ({
        name: 't1',
        exportConfig: {
          enabled: true,
          entryType: 'keyword',
          keywordMode: 'custom',
          keywordColumn: 'name',
          entryPlacement: { position: 'at_depth_as_user', depth: 3, order: 10000 }
        }
      }))
    })
    await syncToWorldbook(session as never)
    const calls = session.worldbook.saveLorebook.mock.calls as unknown as Array<
      [unknown, { entries: Record<number, { role: number; position: string }> }]
    >
    const entries = Object.values(calls[0]![1].entries)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.role === 1)).toBe(true)
  })

  it('at_depth_as_assistant -> role=2', async () => {
    const session = makeSession({
      getTableDef: vi.fn(() => ({
        name: 't1',
        exportConfig: {
          enabled: true,
          entryType: 'constant',
          keywordColumn: '',
          entryPlacement: { position: 'at_depth_as_assistant', depth: 3, order: 10000 }
        }
      }))
    })
    await syncToWorldbook(session as never)
    const calls = session.worldbook.saveLorebook.mock.calls as unknown as Array<
      [unknown, { entries: Record<number, { role: number; position: string }> }]
    >
    const entries = Object.values(calls[0]![1].entries)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.role === 2)).toBe(true)
  })

  it('at_depth_as_system -> role=0', async () => {
    const session = makeSession({
      getTableDef: vi.fn(() => ({
        name: 't1',
        exportConfig: {
          enabled: true,
          entryType: 'constant',
          keywordColumn: '',
          entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 }
        }
      }))
    })
    await syncToWorldbook(session as never)
    const calls = session.worldbook.saveLorebook.mock.calls as unknown as Array<
      [unknown, { entries: Record<number, { role: number; position: string }> }]
    >
    const entries = Object.values(calls[0]![1].entries)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.role === 0)).toBe(true)
  })
})
