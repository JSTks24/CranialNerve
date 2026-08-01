import { describe, expect, it, vi } from 'vitest'
import { syncToWorldbook } from '../src/core/worldbook-sync'

function makeSession(overrides: Record<string, unknown> = {}) {
  const worldbook = {
    listWorldbookNames: vi.fn(() => []),
    createWorldbook: vi.fn(async () => {}),
    loadLorebook: vi.fn(async () => ({ entries: {} })),
    saveLorebook: vi.fn(async () => {}),
    attachToChat: vi.fn(async () => {}),
  }
  const chronicleDef = {
    name: 'cn_chronicle',
    columns: [
      { name: 'key', role: 'key' },
      { name: 'chronicle_text', role: 'summary' },
    ],
  }
  return {
    getChatToken: () => 'token1',
    worldbook,
    getChronicleTableDef: () => chronicleDef,
    listTables: vi.fn(() => ['t1']),
    getTableRowsWithRowid: vi.fn(() => [{ columns: ['row_id', 'name'], rows: [{ name: '甲' }] }]),
    getTableDef: vi.fn(() => ({ name: 't1', exportConfig: { enabled: true, entryType: 'keyword', keywordMode: 'custom', keywords: 'a,b' } })),
    generateKeywordsForTable: vi.fn(async () => ['x', 'y']),
    ...overrides,
  }
}

function getSavedEntries(session: ReturnType<typeof makeSession>): Record<number, { key: string[] }> {
  const calls = session.worldbook.saveLorebook.mock.calls as unknown as Array<[unknown, { entries: Record<number, { key: string[] }> }]>
  expect(calls.length).toBeGreaterThan(0)
  return calls[0]![1].entries
}

describe('syncToWorldbook keyword 分支', () => {
  it('custom 模式用 keywords 静态作 key，不调 AI', async () => {
    const session = makeSession()
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForTable).not.toHaveBeenCalled()
    const entries = Object.values(getSavedEntries(session))
    const t1 = entries.find((e) => e.key.includes('a'))
    expect(t1).toBeTruthy()
    expect(t1!.key).toEqual(['a', 'b'])
  })

  it('ai_prompt 模式同步时调 AI 生成 key', async () => {
    const session = makeSession({
      getTableDef: vi.fn(() => ({ name: 't1', exportConfig: { enabled: true, entryType: 'keyword', keywordMode: 'ai_prompt', keywordAiPrompt: '生成关键词' } })),
    })
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForTable).toHaveBeenCalledWith('t1', '生成关键词')
    const entries = Object.values(getSavedEntries(session))
    const t1 = entries.find((e) => e.key.includes('x'))
    expect(t1).toBeTruthy()
    expect(t1!.key).toEqual(['x', 'y'])
  })

  it('ai_prompt 模式无提示词时跳过，不调 AI 不生成条目', async () => {
    const session = makeSession({
      getTableDef: vi.fn(() => ({ name: 't1', exportConfig: { enabled: true, entryType: 'keyword', keywordMode: 'ai_prompt', keywordAiPrompt: '' } })),
    })
    await syncToWorldbook(session as never)
    expect(session.generateKeywordsForTable).not.toHaveBeenCalled()
    const calls = session.worldbook.saveLorebook.mock.calls as unknown as Array<[unknown, { entries: Record<number, unknown> }]>
    const entries = calls[0]![1].entries
    expect(Object.keys(entries)).toHaveLength(0)
  })
})
