import { describe, expect, it } from 'vitest'
import { buildFeedbackMessages } from '../src/core/table/prompt-feedback'
import type { AiChatMessage } from '../src/db/gateways/ai'

describe('buildFeedbackMessages', () => {
  it('保留 baseMessages 并追加 assistant 上次输出与 user 反馈', () => {
    const base: AiChatMessage[] = [{ role: 'system', content: 'sys' }]
    const result = buildFeedbackMessages(base, 'last raw output', 'SQL syntax error')
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ role: 'system', content: 'sys' })
    expect(result[1]).toEqual({ role: 'assistant', content: 'last raw output' })
    expect(result[2]?.role).toBe('user')
  })

  it('反馈内容包含错误信息', () => {
    const result = buildFeedbackMessages([], 'raw', '缺失 WHERE 条件')
    expect(result[1]?.content).toContain('缺失 WHERE 条件')
  })

  it('反馈内容包含修正要求', () => {
    const result = buildFeedbackMessages([], 'raw', 'err')
    const feedback = result[1]?.content ?? ''
    expect(feedback).toContain('UPDATE/DELETE')
    expect(feedback).toContain('WHERE')
    expect(feedback).toContain('单引号')
  })

  it('反馈内容用 SQL 错误标记包裹', () => {
    const result = buildFeedbackMessages([], 'raw', 'err')
    const feedback = result[1]?.content ?? ''
    expect(feedback).toContain('<cn_sql_error>')
    expect(feedback).toContain('</cn_sql_error>')
  })
})
