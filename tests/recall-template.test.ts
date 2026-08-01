import { describe, expect, it } from 'vitest'
import { buildRecallCardHtml } from '../src/ui/recall-card/template'
import type { RecallCardPayload } from '../src/shared/types/recall-card'

const payload: RecallCardPayload = {
  v: 1,
  items: [
    {
      key: 'CN0001',
      timeDeltaText: '3 天前',
      timeStart: '7月28日',
      timeEnd: '7月29日',
      location: '咖啡馆',
      summary: '主角与友人重逢',
      keyDialogue: '好久不见',
    },
    {
      key: 'CN0002',
      timeDeltaText: '昨天',
      timeStart: '7月30日',
      timeEnd: '7月30日',
      location: '海港',
      summary: '雨夜追车',
      keyDialogue: '别过来',
    },
  ],
}

describe('buildRecallCardHtml', () => {
  it('包含卡片容器与本回合输入标签', () => {
    const html = buildRecallCardHtml(payload, '我今天去了咖啡馆')
    expect(html).toContain('class="cn-recall-card"')
    expect(html).toContain('本回合输入')
  })

  it('条数文案正确', () => {
    const html = buildRecallCardHtml(payload, 'x')
    expect(html).toContain('2 条记忆')
  })

  it('首个 tab radio 选中，其余不选中', () => {
    const html = buildRecallCardHtml(payload, 'x')
    const radios = html.match(/<input[^>]*class="cn-recall-tabs__radio"[^>]*>/g) ?? []
    expect(radios).toHaveLength(2)
    expect(radios[0]).toContain('checked')
    expect(radios[1]).not.toContain('checked')
  })

  it('每个条目 key/时间/地点都渲染', () => {
    const html = buildRecallCardHtml(payload, 'x')
    expect(html).toContain('CN0001')
    expect(html).toContain('CN0002')
    expect(html).toContain('3 天前')
    expect(html).toContain('咖啡馆')
    expect(html).toContain('主角与友人重逢')
    expect(html).toContain('好久不见')
  })

  it('userText 与条目内容被 escape', () => {
    const html = buildRecallCardHtml(payload, '<script>alert(1)</script>"注入"')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    const evilPayload: RecallCardPayload = {
      v: 1,
      items: [{ ...payload.items[0]!, summary: '<img src=x onerror=alert(1)>' }],
    }
    const html2 = buildRecallCardHtml(evilPayload, 'x')
    expect(html2).not.toContain('<img src=x')
    expect(html2).toContain('&lt;img src=x')
  })

  it('radio group 带 uid 互不干扰', () => {
    const a = buildRecallCardHtml(payload, 'x')
    const b = buildRecallCardHtml(payload, 'x')
    const nameA = a.match(/name="(r-[^"]+)"/)![1]
    const nameB = b.match(/name="(r-[^"]+)"/)![1]
    expect(nameA).not.toBe(nameB)
  })
})
