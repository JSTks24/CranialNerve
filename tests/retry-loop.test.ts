import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
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
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('成功路径发射 calling_ai/parsing/saving/complete', async () => {
    const ai = { chatCompletion: vi.fn(async () => validRaw()) }
    const editor = new TableEditor({} as never, ai as never)
    const phases: string[] = []
    const result = await editor.run(makeCtx(), { maxRetries: 2, onProgress: (p) => phases.push(p) })
    expect(result.ok).toBe(true)
    expect(phases).toEqual(['calling_ai', 'parsing', 'saving', 'complete'])
  })

  it('AI 输出含 <thought> 思考链时正确剥离并解析 JSON', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => `<thought>分析剧情变化，需要更新主角信息</thought>\n${validRaw()}`)
    }
    const editor = new TableEditor({} as never, ai as never)
    const result = await editor.run(makeCtx(), { maxRetries: 1 })
    expect(result.ok).toBe(true)
    expect(result.lastSql).toBe('INSERT INTO t VALUES (1)')
  })

  it('AI 输出多个 JSON 时代码层面合并 sql（合并运行兜底）', async () => {
    const raw = [
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO hero VALUES (1)' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: "INSERT INTO cn_chronicle VALUES ('CN0001')" })
    ].join('\n')
    const ai = { chatCompletion: vi.fn(async () => raw) }
    const editor = new TableEditor({} as never, ai as never)
    const result = await editor.run(makeCtx(), { maxRetries: 1 })
    expect(result.ok).toBe(true)
    expect(result.lastSql).toContain('INSERT INTO hero VALUES (1)')
    expect(result.lastSql).toContain("INSERT INTO cn_chronicle VALUES ('CN0001')")
  })

  it('失败重试时发射 retry，最终 error', async () => {
    const sqlExecutor = (await import('../src/core/table/sql-executor')).default as unknown as {
      mockImplementationOnce: (fn: () => unknown) => void
    }
    sqlExecutor.mockImplementationOnce(() => ({ ok: false, error: 'err' }))
    sqlExecutor.mockImplementationOnce(() => ({ ok: false, error: 'err' }))
    const ai = { chatCompletion: vi.fn(async () => validRaw()) }
    const editor = new TableEditor({} as never, ai as never)
    const phases: string[] = []
    const promise = editor.run(makeCtx(), { maxRetries: 2, onProgress: (p) => phases.push(p) })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(phases).toContain('retry')
    expect(phases).toContain('error')
  })

  it('AI 返回无效格式时不调 saving，最终 error', async () => {
    const ai = { chatCompletion: vi.fn(async () => 'not json') }
    const editor = new TableEditor({} as never, ai as never)
    const phases: string[] = []
    const promise = editor.run(makeCtx(), { maxRetries: 1, onProgress: (p) => phases.push(p) })
    await vi.runAllTimersAsync()
    const result = await promise
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

describe('TableEditor.run 错误分类', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('AI 调用失败(infrastructure)不重试，直接返回 errorCategory=infrastructure', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => {
        throw new Error('network timeout')
      })
    }
    const editor = new TableEditor({} as never, ai as never)
    const result = await editor.run(makeCtx(), { maxRetries: 3 })
    expect(result.ok).toBe(false)
    expect(result.errorCategory).toBe('infrastructure')
    expect(result.attempts).toBe(1)
    expect(ai.chatCompletion).toHaveBeenCalledTimes(1)
  })

  it('SQL 执行失败(model)重试至 maxRetries，返回 errorCategory=model', async () => {
    const sqlExecutor = (await import('../src/core/table/sql-executor')).default as unknown as {
      mockImplementation: (fn: () => unknown) => void
    }
    sqlExecutor.mockImplementation(() => ({
      ok: false,
      error: 'syntax error',
      errorCategory: 'model'
    }))
    const ai = { chatCompletion: vi.fn(async () => validRaw()) }
    const editor = new TableEditor({} as never, ai as never)
    const promise = editor.run(makeCtx(), { maxRetries: 2 })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCategory).toBe('model')
    expect(result.attempts).toBe(2)
    expect(ai.chatCompletion).toHaveBeenCalledTimes(2)
  })

  it('解析失败(model)重试', async () => {
    const ai = { chatCompletion: vi.fn(async () => 'not json') }
    const editor = new TableEditor({} as never, ai as never)
    const promise = editor.run(makeCtx(), { maxRetries: 2 })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCategory).toBe('model')
    expect(ai.chatCompletion).toHaveBeenCalledTimes(2)
  })
})
