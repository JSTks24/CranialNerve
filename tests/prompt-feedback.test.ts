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

  it('merged 模式反馈含 merged 专用说明', () => {
    const result = buildFeedbackMessages([], 'raw', 'err', 'merged')
    const feedback = result[1]?.content ?? ''
    expect(feedback).toContain('merged 模式')
    expect(feedback).toContain('同时包含')
    expect(feedback).toContain('sql 不允许为空字符串')
  })

  it('merged 模式反馈含防退化措辞（表格与纪要同等重要）', () => {
    const result = buildFeedbackMessages([], 'raw', 'err', 'merged')
    const feedback = result[1]?.content ?? ''
    expect(feedback).toContain('表格变更与纪要同等重要')
    expect(feedback).toContain('禁止为满足纪要要求省略表格变更')
    expect(feedback).toContain('只有确认所有表均无变化时才允许只写纪要')
  })

  it('chronicle 模式反馈强调必写纪要', () => {
    const result = buildFeedbackMessages([], 'raw', 'err', 'chronicle')
    const feedback = result[1]?.content ?? ''
    expect(feedback).toContain('必须包含对纪要表的 INSERT')
  })

  it('table 模式反馈保留留空占位说明', () => {
    const result = buildFeedbackMessages([], 'raw', 'err', 'table')
    const feedback = result[1]?.content ?? ''
    expect(feedback).toContain('留空字符串')
  })

  it('未传 runMode 时保留默认组合说明', () => {
    const result = buildFeedbackMessages([], 'raw', 'err')
    const feedback = result[1]?.content ?? ''
    expect(feedback).toContain('留空字符串')
    expect(feedback).toContain('必须包含对纪要表的 INSERT')
  })
})
