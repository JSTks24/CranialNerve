import { describe, expect, it } from 'vitest'
import { buildOpeningCardHtml } from '../src/ui/recall-card/template'

describe('buildOpeningCardHtml', () => {
  it('包含卡片容器与品牌头', () => {
    const html = buildOpeningCardHtml('你好，初次见面')
    expect(html).toContain('class="cn-recall-card"')
    expect(html).toContain('CranialNerve')
    expect(html).toContain('cn-recall-card__head')
  })

  it('中间只有一句话文案，无徽标无 tabs', () => {
    const html = buildOpeningCardHtml('x')
    expect(html).toContain('故事的序幕，由你亲手揭开')
    expect(html).toContain('cn-recall-card__opening')
    expect(html).not.toContain('条记忆')
    expect(html).not.toContain('cn-recall-card__count')
    expect(html).not.toContain('cn-recall-tabs')
  })

  it('保留底部本回合输入区', () => {
    const html = buildOpeningCardHtml('你好，初次见面')
    expect(html).toContain('本回合输入')
    expect(html).toContain('你好，初次见面')
  })

  it('userText 被 escape', () => {
    const html = buildOpeningCardHtml('<script>alert(1)</script>"注入"')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
