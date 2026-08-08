import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import TableEditor, { parseTableEditSql, type PromptContext } from '../src/core/table/retry-loop'
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

function validRaw(sql = 'INSERT INTO t VALUES (1)'): string {
  return JSON.stringify({ format: SQL_EDIT_FORMAT, sql })
}

function editorWith(ai: { chatCompletion: () => Promise<string> }): TableEditor {
  return new TableEditor({} as never, ai as never)
}

describe('parseTableEditSql 多对象解析与数量校验', () => {
  it('单个对象正常解析', () => {
    const r = parseTableEditSql(validRaw())
    expect(r).toEqual({ ok: true, objects: [{ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO t VALUES (1)' }] })
  })

  it('多个对象按序独立返回，不合并', () => {
    const raw = [
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO hero VALUES (1)' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: "INSERT INTO cn_chronicle VALUES ('CN0001')" })
    ].join('\n')
    const r = parseTableEditSql(raw, 2)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.objects).toHaveLength(2)
    expect(r.objects[0]!.sql).toBe('INSERT INTO hero VALUES (1)')
    expect(r.objects[1]!.sql).toBe("INSERT INTO cn_chronicle VALUES ('CN0001')")
  })

  it('空 sql 对象保留位置', () => {
    const raw = [
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO a VALUES (1)' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: '' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO c VALUES (2)' })
    ].join('\n')
    const r = parseTableEditSql(raw, 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.objects.map((o) => o.sql)).toEqual(['INSERT INTO a VALUES (1)', '', 'INSERT INTO c VALUES (2)'])
  })

  it('数量不足判失败并注明期望与实际', () => {
    const raw = [
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO a VALUES (1)' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO b VALUES (2)' })
    ].join('\n')
    const r = parseTableEditSql(raw, 3)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('3 个')
    expect(r.reason).toContain('2 个')
  })

  it('数量超出同样判失败', () => {
    const raw = [
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO a VALUES (1)' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO b VALUES (2)' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO c VALUES (3)' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO d VALUES (4)' })
    ].join('\n')
    expect(parseTableEditSql(raw, 3).ok).toBe(false)
  })

  it('format 不符的对象判失败', () => {
    const raw = JSON.stringify({ format: 'wrong_format', sql: 'INSERT INTO a VALUES (1)' })
    const r = parseTableEditSql(raw)
    expect(r.ok).toBe(false)
  })

  it('不传 expectedCount 时跳过数量校验', () => {
    const raw = JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO a VALUES (1)' })
    expect(parseTableEditSql(raw).ok).toBe(true)
  })

  it('items 数组形态按序解析（JSON 限定模式）', () => {
    const raw = JSON.stringify({
      format: SQL_EDIT_FORMAT,
      items: [{ sql: 'INSERT INTO a VALUES (1)' }, { sql: "INSERT INTO cn_chronicle VALUES ('CN0001')" }],
    })
    const r = parseTableEditSql(raw, 2)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.objects.map((o) => o.sql)).toEqual(['INSERT INTO a VALUES (1)', "INSERT INTO cn_chronicle VALUES ('CN0001')"])
  })

  it('items 数组带 thought 与 json fence 时正常解析', () => {
    const raw = `<thought>分析剧情变化</thought>\n\`\`\`json\n${JSON.stringify({
      format: SQL_EDIT_FORMAT,
      items: [{ sql: 'INSERT INTO a VALUES (1)' }, { sql: '' }],
    })}\n\`\`\``
    const r = parseTableEditSql(raw, 2)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.objects.map((o) => o.sql)).toEqual(['INSERT INTO a VALUES (1)', ''])
  })

  it('items 与多顶层对象两种形态兼容', () => {
    const raw = [
      JSON.stringify({ format: SQL_EDIT_FORMAT, items: [{ sql: 'INSERT INTO a VALUES (1)' }, { sql: 'INSERT INTO b VALUES (2)' }] }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO c VALUES (3)' }),
    ].join('\n')
    const r = parseTableEditSql(raw, 3)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.objects.map((o) => o.sql)).toEqual(['INSERT INTO a VALUES (1)', 'INSERT INTO b VALUES (2)', 'INSERT INTO c VALUES (3)'])
  })

  it('items 数量不足判失败', () => {
    const raw = JSON.stringify({
      format: SQL_EDIT_FORMAT,
      items: [{ sql: 'INSERT INTO a VALUES (1)' }, { sql: 'INSERT INTO b VALUES (2)' }],
    })
    const r = parseTableEditSql(raw, 3)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('3 个')
  })

  it('items 元素含非字符串 sql 判失败', () => {
    const raw = JSON.stringify({
      format: SQL_EDIT_FORMAT,
      items: [{ sql: 'INSERT INTO a VALUES (1)' }, { sql: 123 }],
    })
    expect(parseTableEditSql(raw).ok).toBe(false)
  })
})

describe('TableEditor.run 多对象与强校验', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('多对象成功路径 sqls 按序返回', async () => {
    const raw = [
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO hero VALUES (1)' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: "INSERT INTO cn_chronicle VALUES ('CN0001')" })
    ].join('\n')
    const ai = { chatCompletion: vi.fn(async () => raw) }
    const result = await editorWith(ai).run(makeCtx(), { maxRetries: 1, expectedSqlObjects: 2 })
    expect(result.ok).toBe(true)
    expect(result.sqls).toEqual(['INSERT INTO hero VALUES (1)', "INSERT INTO cn_chronicle VALUES ('CN0001')"])
  })

  it('空 sql 对象保留位置且 executor 收到全部 edits', async () => {
    const sqlExecutor = (await import('../src/core/table/sql-executor')).default as unknown as {
      mockClear: () => void
      mock: { calls: unknown[][] }
    }
    sqlExecutor.mockClear()
    const raw = [
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO a VALUES (1)' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: '' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO c VALUES (2)' })
    ].join('\n')
    const ai = { chatCompletion: vi.fn(async () => raw) }
    const result = await editorWith(ai).run(makeCtx(), { maxRetries: 1, expectedSqlObjects: 3 })
    expect(result.ok).toBe(true)
    expect(result.sqls).toEqual(['INSERT INTO a VALUES (1)', '', 'INSERT INTO c VALUES (2)'])
    const edits = sqlExecutor.mock.calls[0]?.[1] as Array<{ sql: string }>
    expect(edits).toHaveLength(3)
    expect(edits.map((e) => e.sql)).toEqual(['INSERT INTO a VALUES (1)', '', 'INSERT INTO c VALUES (2)'])
  })

  it('数量不足判解析失败并重试至 maxRetries', async () => {
    const ai = { chatCompletion: vi.fn(async () => validRaw()) }
    const promise = editorWith(ai).run(makeCtx(), { maxRetries: 2, expectedSqlObjects: 3 })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCategory).toBe('model')
    expect(ai.chatCompletion).toHaveBeenCalledTimes(2)
    expect(result.error).toContain('3 个 JSON 对象')
  })

  it('table 模式空 sql 通过校验', async () => {
    const raw = [
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: '' }),
      JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO t VALUES (1)' })
    ].join('\n')
    const ai = { chatCompletion: vi.fn(async () => raw) }
    const result = await editorWith(ai).run(makeCtx(), { maxRetries: 1, expectedSqlObjects: 2 })
    expect(result.ok).toBe(true)
    expect(result.sqls).toEqual(['', 'INSERT INTO t VALUES (1)'])
  })

  it('requireChronicleInsert 缺 INSERT 时失败重试', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO t VALUES (1)' }))
    }
    const promise = editorWith(ai).run(makeCtx(), { maxRetries: 2, expectedSqlObjects: 1, requireChronicleInsert: true })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(ai.chatCompletion).toHaveBeenCalledTimes(2)
    expect(result.error).toContain('cn_chronicle')
  })

  it('requireChronicleInsert 含 INSERT 时通过', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => JSON.stringify({ format: SQL_EDIT_FORMAT, sql: "INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0001', '剧情')" }))
    }
    const result = await editorWith(ai).run(makeCtx(), { maxRetries: 1, expectedSqlObjects: 1, requireChronicleInsert: true })
    expect(result.ok).toBe(true)
  })

  it('items 形态 + requireChronicleInsert 强校验生效', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => JSON.stringify({
        format: SQL_EDIT_FORMAT,
        items: [
          { sql: "INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0001', '剧情1')" },
          { sql: "INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0002', '剧情2')" },
        ],
      }))
    }
    const result = await editorWith(ai).run(makeCtx(), { maxRetries: 1, expectedSqlObjects: 2, requireChronicleInsert: true })
    expect(result.ok).toBe(true)
    expect(result.sqls).toEqual([
      "INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0001', '剧情1')",
      "INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0002', '剧情2')",
    ])
  })

  it('items 形态缺纪要 INSERT 时失败重试', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => JSON.stringify({
        format: SQL_EDIT_FORMAT,
        items: [
          { sql: "INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0001', '剧情1')" },
          { sql: 'INSERT INTO t VALUES (1)' },
        ],
      }))
    }
    const promise = editorWith(ai).run(makeCtx(), { maxRetries: 2, expectedSqlObjects: 2, requireChronicleInsert: true })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(ai.chatCompletion).toHaveBeenCalledTimes(2)
  })

  it('requireChronicleInsert 缺纪要时错误信息点名元素序号', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => JSON.stringify({
        format: SQL_EDIT_FORMAT,
        items: [
          { sql: "INSERT INTO cn_chronicle (key) VALUES ('CN0001')" },
          { sql: 'INSERT INTO t VALUES (1)' },
          { sql: 'UPDATE t SET a = 1 WHERE b = 2' },
        ],
      }))
    }
    const promise = editorWith(ai).run(makeCtx(), { maxRetries: 1, expectedSqlObjects: 3, requireChronicleInsert: true })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.error).toContain('第 2、3 个元素')
    expect(result.error).toContain('cn_chronicle')
    expect(result.error).toContain('每轮必写')
  })

  it('requireChronicleInsert 全部元素含纪要时通过且不点名', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => JSON.stringify({
        format: SQL_EDIT_FORMAT,
        items: [
          { sql: "INSERT INTO cn_chronicle (key) VALUES ('CN0001')" },
          { sql: "INSERT INTO cn_chronicle (key) VALUES ('CN0002'); UPDATE t SET a = 1 WHERE b = 2" },
        ],
      }))
    }
    const result = await editorWith(ai).run(makeCtx(), { maxRetries: 1, expectedSqlObjects: 2, requireChronicleInsert: true })
    expect(result.ok).toBe(true)
  })

  it('merged 模式缺纪要重试时反馈含 merged 专用说明', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => JSON.stringify({ format: SQL_EDIT_FORMAT, sql: 'INSERT INTO t VALUES (1)' }))
    }
    const promise = editorWith(ai).run(makeCtx(), { maxRetries: 2, expectedSqlObjects: 1, requireChronicleInsert: true, runMode: 'merged' })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(ai.chatCompletion).toHaveBeenCalledTimes(2)
    const callArgs = ai.chatCompletion.mock.calls as unknown as Array<[import('../src/db/gateways/ai').AiChatMessage[]]>
    const messages = callArgs[1]![0]
    const feedback = messages[messages.length - 1]!.content
    expect(feedback).toContain('merged 模式')
    expect(feedback).toContain('同时包含')
  })

  it('成功路径发射 calling_ai/parsing/saving/complete', async () => {
    const ai = { chatCompletion: vi.fn(async () => validRaw()) }
    const phases: string[] = []
    const result = await editorWith(ai).run(makeCtx(), { maxRetries: 2, onProgress: (p) => phases.push(p) })
    expect(result.ok).toBe(true)
    expect(phases).toEqual(['calling_ai', 'parsing', 'saving', 'complete'])
  })

  it('AI 输出含 <thought> 思考链时正确剥离并解析 JSON', async () => {
    const ai = {
      chatCompletion: vi.fn(async () => `<thought>分析剧情变化，需要更新主角信息</thought>\n${validRaw()}`)
    }
    const result = await editorWith(ai).run(makeCtx(), { maxRetries: 1 })
    expect(result.ok).toBe(true)
    expect(result.sqls?.[0]).toBe('INSERT INTO t VALUES (1)')
  })

  it('失败重试时发射 retry，最终 error', async () => {
    const sqlExecutor = (await import('../src/core/table/sql-executor')).default as unknown as {
      mockImplementationOnce: (fn: () => unknown) => void
    }
    sqlExecutor.mockImplementationOnce(() => ({ ok: false, error: 'err' }))
    sqlExecutor.mockImplementationOnce(() => ({ ok: false, error: 'err' }))
    const ai = { chatCompletion: vi.fn(async () => validRaw()) }
    const phases: string[] = []
    const promise = editorWith(ai).run(makeCtx(), { maxRetries: 2, onProgress: (p) => phases.push(p) })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(phases).toContain('retry')
    expect(phases).toContain('error')
  })

  it('AI 返回无效格式时不调 saving，最终 error', async () => {
    const ai = { chatCompletion: vi.fn(async () => 'not json') }
    const phases: string[] = []
    const promise = editorWith(ai).run(makeCtx(), { maxRetries: 1, onProgress: (p) => phases.push(p) })
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
    let detail: { attempt?: number; maxRetries?: number } | undefined
    await editorWith(ai).run(makeCtx(), { maxRetries: 3, onProgress: (_p, d) => { detail = d } })
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
    const result = await editorWith(ai).run(makeCtx(), { maxRetries: 3 })
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
    const promise = editorWith(ai).run(makeCtx(), { maxRetries: 2 })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCategory).toBe('model')
    expect(result.attempts).toBe(2)
    expect(ai.chatCompletion).toHaveBeenCalledTimes(2)
  })

  it('解析失败(model)重试', async () => {
    const ai = { chatCompletion: vi.fn(async () => 'not json') }
    const promise = editorWith(ai).run(makeCtx(), { maxRetries: 2 })
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.errorCategory).toBe('model')
    expect(ai.chatCompletion).toHaveBeenCalledTimes(2)
  })
})
