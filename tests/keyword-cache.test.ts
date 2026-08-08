import { describe, expect, it, vi } from 'vitest'
import type { TableDef } from '../src/shared/types/table'
import {
  computeRowFingerprint,
  computeTableFingerprint,
  entryKeywords,
  entryMatches,
  keywordsFieldName,
  readKeywordsCache,
  writeKeywordsCache
} from '../src/core/keyword-cache'

function makeChat(n: number) {
  const messages: Array<{ is_user?: boolean; extra?: Record<string, unknown>; mes?: string }> = []
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

function makeSession(chat: ReturnType<typeof makeChat>['chat'], tableDef: unknown = undefined) {
  return {
    chat,
    getTableDef: vi.fn(() => tableDef)
  }
}

const PK_DEF = {
  name: 't1',
  displayName: '测试表',
  columns: [
    { name: 'name', displayName: '姓名', type: 'TEXT', constraints: { primaryKey: true } },
    { name: 'desc', displayName: '描述', type: 'TEXT' }
  ]
}

describe('keywordsFieldName', () => {
  it('前缀拼接', () => {
    expect(keywordsFieldName('important_characters')).toBe('CN_KEYWORDS_important_characters')
  })
})

describe('computeTableFingerprint', () => {
  it('提示词变化导致指纹变化', () => {
    const segA = { id: 's1', name: '提示词A', role: 'system' as const, content: 'A' }
    const segB = { id: 's2', name: '提示词B', role: 'system' as const, content: 'B' }
    const base: TableDef = { name: 't1', displayName: '测试表', columns: [], exportConfig: { enabled: true, entryType: 'keyword', keywordMode: 'ai_prompt', keywordColumn: '', keywordAiPrompt: [segA] } }
    const other: TableDef = { name: 't1', displayName: '测试表', columns: [], exportConfig: { enabled: true, entryType: 'keyword', keywordMode: 'ai_prompt', keywordColumn: '', keywordAiPrompt: [segB] } }
    expect(computeTableFingerprint(base, ['name'])).not.toBe(computeTableFingerprint(other, ['name']))
  })

  it('列变化导致指纹变化', () => {
    const def: TableDef = { name: 't1', displayName: '测试表', columns: [], exportConfig: { enabled: true, entryType: 'keyword', keywordMode: 'ai_prompt', keywordColumn: '', keywordAiPrompt: [] } }
    expect(computeTableFingerprint(def, ['name'])).not.toBe(computeTableFingerprint(def, ['name', 'desc']))
  })

  it('同配置同指纹', () => {
    const def: TableDef = { name: 't1', displayName: '测试表', columns: [], exportConfig: { enabled: true, entryType: 'keyword', keywordMode: 'ai_prompt', keywordColumn: '', keywordAiPrompt: [] } }
    expect(computeTableFingerprint(def, ['name'])).toBe(computeTableFingerprint(def, ['name']))
  })
})

describe('computeRowFingerprint', () => {
  it('排除 __rowid__:rowid 变指纹不变', () => {
    const a = computeRowFingerprint({ __rowid__: 1, name: '艾琳', desc: '骑士' })
    const b = computeRowFingerprint({ __rowid__: 2, name: '艾琳', desc: '骑士' })
    expect(a).toBe(b)
  })

  it('内容变指纹变', () => {
    expect(computeRowFingerprint({ __rowid__: 1, name: '艾琳', desc: '骑士' })).not.toBe(
      computeRowFingerprint({ __rowid__: 1, name: '艾琳', desc: '叛逃骑士' })
    )
  })
})

describe('readKeywordsCache', () => {
  it('写读往返一致', () => {
    const { chat } = makeChat(3)
    const session = makeSession(chat, PK_DEF)
    const rows = [
      { __rowid__: 1, name: '艾琳', desc: '骑士' },
      { __rowid__: 2, name: '洛恩', desc: '法师' }
    ]
    writeKeywordsCache(session as never, 't1', rows, [['艾琳'], ['洛恩']], 'fp')
    const cache = readKeywordsCache(session as never, 't1')
    expect(cache).not.toBeNull()
    expect(cache!.tf).toBe('fp')
    expect(cache!.rows['1']!.k).toEqual(['艾琳'])
    expect(cache!.rows['1']!.id).toBe('艾琳')
    expect(cache!.rows['2']!.k).toEqual(['洛恩'])
  })

  it('取最新一条携带缓存的消崽', () => {
    const { chat, messages } = makeChat(3)
    messages[0]!.extra = { 'CN_KEYWORDS_t1': JSON.stringify({ v: 1, tf: 'old', rows: { 1: { k: ['旧'], f: 'x' } } }) }
    messages[2]!.extra = { 'CN_KEYWORDS_t1': JSON.stringify({ v: 1, tf: 'new', rows: { 1: { k: ['新'], f: 'y' } } }) }
    const session = makeSession(chat)
    const cache = readKeywordsCache(session as never, 't1')
    expect(cache!.tf).toBe('new')
  })

  it('坏 JSON 返回 null', () => {
    const { chat, messages } = makeChat(1)
    messages[0]!.extra = { 'CN_KEYWORDS_t1': '{broken' }
    const session = makeSession(chat)
    expect(readKeywordsCache(session as never, 't1')).toBeNull()
  })

  it('无缓存返回 null', () => {
    const { chat } = makeChat(2)
    const session = makeSession(chat)
    expect(readKeywordsCache(session as never, 't1')).toBeNull()
  })
})

describe('writeKeywordsCache', () => {
  it('写最新帧消息所在楼层', () => {
    const { chat, messages } = makeChat(4)
    messages[1]!.extra = { CN_FRAME_: 'frame' }
    const session = makeSession(chat, PK_DEF)
    writeKeywordsCache(
      session as never,
      't1',
      [{ __rowid__: 5, name: '艾琳', desc: '骑士' }],
      [['艾琳']],
      'fp'
    )
    const raw = messages[1]!.extra!['CN_KEYWORDS_t1']
    expect(typeof raw).toBe('string')
    const cache = JSON.parse(raw as string)
    expect(cache.rows['5'].k).toEqual(['艾琳'])
  })

  it('无帧时回退最后一条消息', () => {
    const { chat, messages } = makeChat(3)
    const session = makeSession(chat, PK_DEF)
    writeKeywordsCache(session as never, 't1', [{ __rowid__: 1, name: '艾琳' }], [['艾琳']], 'fp')
    expect(messages[2]!.extra!['CN_KEYWORDS_t1']).toBeTruthy()
  })

  it('空聊天不抛异常', () => {
    const { chat } = makeChat(0)
    const session = makeSession(chat, PK_DEF)
    expect(() => writeKeywordsCache(session as never, 't1', [{ __rowid__: 1, name: '艾琳' }], [['艾琳']], 'fp')).not.toThrow()
  })

  it('rowKeysList 按位置对齐写入', () => {
    const { chat } = makeChat(1)
    const session = makeSession(chat, PK_DEF)
    writeKeywordsCache(
      session as never,
      't1',
      [
        { __rowid__: 10, name: '甲' },
        { __rowid__: 11, name: '乙' }
      ],
      [['甲词'], ['乙词']],
      'fp'
    )
    const cache = readKeywordsCache(session as never, 't1')
    expect(cache!.rows['10']!.k).toEqual(['甲词'])
    expect(cache!.rows['11']!.k).toEqual(['乙词'])
  })

  it('行无 rowid 跳过', () => {
    const { chat } = makeChat(1)
    const session = makeSession(chat, PK_DEF)
    writeKeywordsCache(session as never, 't1', [{ name: '甲' }], [['甲词']], 'fp')
    const cache = readKeywordsCache(session as never, 't1')
    expect(Object.keys(cache!.rows)).toHaveLength(0)
  })
})

describe('entryMatches / entryKeywords', () => {
  function makeCache(rows: Record<string, { k: string[]; f?: string; id?: string }>) {
    return {
      v: 1 as const,
      tf: 'fp',
      rows: Object.fromEntries(
        Object.entries(rows).map(([rid, e]) => [rid, { f: e.f ?? 'x', ...e }])
      )
    }
  }

  it('id 相同则命中(内容变了也命中)', () => {
    const cache = makeCache({ 1: { k: ['艾琳'], id: '艾琳' } })
    expect(entryMatches(cache, PK_DEF, { __rowid__: 1, name: '艾琳', desc: '变成叛逃骑士了' })).toBe(true)
    expect(entryKeywords(cache, { __rowid__: 1, name: '艾琳' })).toEqual(['艾琳'])
  })

  it('id 不同则未命中(rowid 复用防御)', () => {
    const cache = makeCache({ 1: { k: ['艾琳'], id: '艾琳' } })
    expect(entryMatches(cache, PK_DEF, { __rowid__: 1, name: '新角色', desc: 'x' })).toBe(false)
  })

  it('无 id 列时指纹兜底:内容不变命中', () => {
    const def = { name: 't1', displayName: '测试表', columns: [{ name: 'name', displayName: '姓名', type: 'TEXT' }] }
    const cache = makeCache({ 1: { k: ['词'], f: computeRowFingerprint({ __rowid__: 1, name: '甲' }) } })
    expect(entryMatches(cache, def, { __rowid__: 1, name: '甲' })).toBe(true)
    expect(entryMatches(cache, def, { __rowid__: 1, name: '乙' })).toBe(false)
  })

  it('缓存无该 rowid 未命中', () => {
    const cache = makeCache({ 1: { k: ['艾琳'], id: '艾琳' } })
    expect(entryMatches(cache, PK_DEF, { __rowid__: 2, name: '艾琳' })).toBe(false)
  })

  it('缓存 id 缺失但当前行有 id 时走指纹', () => {
    const cache = makeCache({ 1: { k: ['艾琳'], f: computeRowFingerprint({ __rowid__: 1, name: '艾琳', desc: '骑士' }) } })
    expect(entryMatches(cache, PK_DEF, { __rowid__: 1, name: '艾琳', desc: '骑士' })).toBe(true)
    expect(entryMatches(cache, PK_DEF, { __rowid__: 1, name: '艾琳', desc: '法师' })).toBe(false)
  })

  it('entryKeywords 无条目返回空数组', () => {
    const cache = makeCache({ 1: { k: ['艾琳'] } })
    expect(entryKeywords(cache, { __rowid__: 9 })).toEqual([])
  })
})
