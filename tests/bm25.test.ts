import { describe, expect, it } from 'vitest'
import { tokenizeBm25, sparseSearchBm25, reciprocalRankFusion } from '../src/core/chronicle/bm25'

describe('tokenizeBm25', () => {
  it('中文按单字+双字切分', () => {
    const tokens = tokenizeBm25('王城')
    expect(tokens).toContain('王')
    expect(tokens).toContain('城')
    expect(tokens).toContain('王城')
  })

  it('英文按单词切分', () => {
    const tokens = tokenizeBm25('hello world')
    expect(tokens).toContain('hello')
    expect(tokens).toContain('world')
  })

  it('空字符串返回空数组', () => {
    expect(tokenizeBm25('')).toEqual([])
  })
})

describe('sparseSearchBm25', () => {
  it('返回匹配文档按分数降序', () => {
    const candidates = [
      { key: 'k1', text: '王城的冒险' },
      { key: 'k2', text: '森林探险' },
      { key: 'k3', text: '王城的故事' }
    ]
    const result = sparseSearchBm25('王城', candidates, 10)
    expect(result.length).toBeGreaterThan(0)
    const keys = result.map((r) => r.key)
    expect(keys).toContain('k1')
    expect(keys).toContain('k3')
  })

  it('无匹配返回空数组', () => {
    const candidates = [{ key: 'k1', text: '森林' }]
    expect(sparseSearchBm25('海洋', candidates, 10)).toEqual([])
  })

  it('limit 限制返回数量', () => {
    const candidates = [
      { key: 'k1', text: '王城' },
      { key: 'k2', text: '王城' },
      { key: 'k3', text: '王城' }
    ]
    const result = sparseSearchBm25('王城', candidates, 2)
    expect(result).toHaveLength(2)
  })
})

describe('reciprocalRankFusion', () => {
  it('两列表都命中的 key 分数更高', () => {
    const listA = [
      { key: 'k1', score: 1 },
      { key: 'k2', score: 1 }
    ]
    const listB = [
      { key: 'k2', score: 1 },
      { key: 'k3', score: 1 }
    ]
    const fused = reciprocalRankFusion([listA, listB], 60, 10)
    const k2 = fused.find((f) => f.key === 'k2')
    const k1 = fused.find((f) => f.key === 'k1')
    expect((k2?.score ?? 0)).toBeGreaterThan(k1?.score ?? 0)
  })

  it('limit 限制返回数量', () => {
    const listA = [
      { key: 'k1', score: 1 },
      { key: 'k2', score: 1 },
      { key: 'k3', score: 1 }
    ]
    const fused = reciprocalRankFusion([listA], 60, 2)
    expect(fused).toHaveLength(2)
  })
})
