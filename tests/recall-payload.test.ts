import { describe, expect, it } from 'vitest'
import {
  parseRecallPayload,
  serializeRecallPayload,
  stripKeyLineFromMes,
  type RecallItemLike,
} from '../src/shared/recall-payload'

const sampleItems: RecallItemLike[] = [
  {
    key: 'CN0001',
    timeDeltaText: '3 天前',
    entry: {
      timeStart: '7月28日',
      timeEnd: '7月29日',
      content: {
        location: '咖啡馆',
        summary: '主角与友人重逢',
        keyDialogue: '好久不见',
      },
    },
  },
  {
    key: 'CN0002',
    timeDeltaText: '昨天',
    entry: {
      timeStart: '7月30日',
      timeEnd: '',
      content: {
        location: '',
        summary: '雨夜追车',
        keyDialogue: '',
      },
    },
  },
]

describe('serializeRecallPayload / parseRecallPayload', () => {
  it('roundtrip 保留全部字段', () => {
    const raw = serializeRecallPayload(sampleItems)
    const payload = parseRecallPayload(raw)
    expect(payload).not.toBeNull()
    expect(payload!.v).toBe(1)
    expect(payload!.items).toHaveLength(2)
    expect(payload!.items[0]).toEqual({
      key: 'CN0001',
      timeDeltaText: '3 天前',
      timeStart: '7月28日',
      timeEnd: '7月29日',
      location: '咖啡馆',
      summary: '主角与友人重逢',
      keyDialogue: '好久不见',
    })
  })

  it('非字符串输入返回 null', () => {
    expect(parseRecallPayload(undefined)).toBeNull()
    expect(parseRecallPayload(null)).toBeNull()
    expect(parseRecallPayload(123)).toBeNull()
    expect(parseRecallPayload({ v: 1, items: [] })).toBeNull()
  })

  it('坏 JSON 返回 null', () => {
    expect(parseRecallPayload('{oops')).toBeNull()
    expect(parseRecallPayload('')).toBeNull()
  })

  it('items 缺失或为空返回 null', () => {
    expect(parseRecallPayload('{"v":1}')).toBeNull()
    expect(parseRecallPayload('{"v":1,"items":[]}')).toBeNull()
  })

  it('item 缺 key 返回 null', () => {
    expect(parseRecallPayload('{"v":1,"items":[{"summary":"x"}]}')).toBeNull()
  })

  it('item 缺次要字段兜底为空串', () => {
    const payload = parseRecallPayload('{"v":1,"items":[{"key":"CN0007"}]}')
    expect(payload).not.toBeNull()
    expect(payload!.items[0]).toEqual({
      key: 'CN0007',
      timeDeltaText: '',
      timeStart: '',
      timeEnd: '',
      location: '',
      summary: '',
      keyDialogue: '',
    })
  })
})

describe('stripKeyLineFromMes', () => {
  it('剥离首行 keys 保留原话', () => {
    expect(stripKeyLineFromMes('CN0001 CN0002\n我今天去了咖啡馆')).toBe('我今天去了咖啡馆')
  })

  it('支持 CRLF', () => {
    expect(stripKeyLineFromMes('CN0001\r\n原话')).toBe('原话')
  })

  it('无 keys 行原样返回', () => {
    const mes = '我今天去了咖啡馆'
    expect(stripKeyLineFromMes(mes)).toBe(mes)
  })

  it('keys 后紧跟文字不算 keys 行', () => {
    const mes = 'CN0001就是那个编号\n原话'
    expect(stripKeyLineFromMes(mes)).toBe(mes)
  })

  it('仅 keys 无换行返回空串', () => {
    expect(stripKeyLineFromMes('CN0001 CN0002')).toBe('')
  })

  it('三位数编号不误匹配', () => {
    const mes = 'CN001不是合法键\n原话'
    expect(stripKeyLineFromMes(mes)).toBe(mes)
  })
})
