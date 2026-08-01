import { describe, expect, it, vi } from 'vitest'
import TableEditor, { type PromptContext } from '../src/core/table/retry-loop'
import { SQL_EDIT_FORMAT } from '../src/shared/constants/sql-json'

vi.mock('../src/core/table/sql-executor', () => ({
  default: vi.fn(() => ({ ok: true })),
}))

function makeCtx(): PromptContext {
  return {
    segments: [],
    userPrompt: 'x',
    clientConfig: {} as never,
    params: {} as never,
  }
}

function validRaw(): string {
  return JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO t VALUES (1)' })
}

describe('TableEditor.run onProgress 阶段事件', () => {
  it('成功路径发射 calling_ai/parsing/saving/complete', async () => {
    const ai = { chatCompletion: vi.fn(async () => validRaw()) }
    const editor = new TableEditor({} as never, ai as never)
    const phases: string[] = []
    const result = await editor.run(makeCtx(), { maxRetries: 2, onProgress: (p) => phases.push(p) })
    expect(result.ok).toBe(true)
    expect(phases).toEqual(['calling_ai', 'parsing', 'saving', 'complete'])
  })

  it('失败重试时发射 retry，最终 error', async () => {
    const sqlExecutor = (await import('../src/core/table/sql-executor')).default as unknown as { mockImplementationOnce: (fn: () => unknown) => void }
    sqlExecutor.mockImplementationOnce(() => ({ ok: false, error: 'err' }))
    sqlExecutor.mockImplementationOnce(() => ({ ok: false, error: 'err' }))
    const ai = { chatCompletion: vi.fn(async () => validRaw()) }
    const editor = new TableEditor({} as never, ai as never)
    const phases: string[] = []
    const result = await editor.run(makeCtx(), { maxRetries: 2, onProgress: (p) => phases.push(p) })
    expect(result.ok).toBe(false)
    expect(phases).toContain('retry')
    expect(phases).toContain('error')
  })

  it('AI 返回无效格式时不调 saving，最终 error', async () => {
    const ai = { chatCompletion: vi.fn(async () => 'not json') }
    const editor = new TableEditor({} as never, ai as never)
    const phases: string[] = []
    const result = await editor.run(makeCtx(), { maxRetries: 1, onProgress: (p) => phases.push(p) })
    expect(result.ok).toBe(false)
    expect(phases).toContain('calling_ai')
    expect(phases).toContain('parsing')
    expect(phases).not.toContain('saving')
    expect(phases).toContain('error')
  })

  it('detail 携带 attempt 与 maxRetries', async () => {
    const ai = { chatCompletion: vi.fn(async () => validRaw()) }
    const editor = new TableEditor({} as never, ai as never)
    let detail: { attempt?: number; maxRetries?: number } | undefined
    await editor.run(makeCtx(), { maxRetries: 3, onProgress: (_p, d) => { detail = d } })
    expect(detail?.maxRetries).toBe(3)
    expect(detail?.attempt).toBe(1)
  })
})
