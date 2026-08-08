import { describe, expect, it } from 'vitest'
import { fnv1aHash } from '../src/shared/fingerprint'

describe('fnv1aHash', () => {
  it('确定性:同输入同输出', () => {
    const input = '艾琳|叛逃骑士|3'
    expect(fnv1aHash(input)).toBe(fnv1aHash(input))
  })

  it('内容敏感:不同输入不同输出', () => {
    expect(fnv1aHash('a')).not.toBe(fnv1aHash('b'))
    expect(fnv1aHash('abc')).not.toBe(fnv1aHash('abd'))
  })

  it('顺序敏感:列序不同指纹不同', () => {
    expect(fnv1aHash('a|b')).not.toBe(fnv1aHash('b|a'))
  })

  it('输出为定长十六进制字符串', () => {
    const out = fnv1aHash('任意输入')
    expect(out).toMatch(/^[0-9a-f]{8}$/)
  })

  it('空输入也返回定长结果', () => {
    expect(fnv1aHash('')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('与 checkpoint-transfer 既有实现同值', () => {
    expect(fnv1aHash('hello')).toBe('4f9f2cab')
  })
})
