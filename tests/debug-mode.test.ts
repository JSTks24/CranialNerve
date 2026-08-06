import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../src/db/gateways/host-context', () => ({
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' })
}))

import { pushLog, getAllLogs, clearLogs, setDebugMode, LEVEL_ORDER } from '../src/shared/log-buffer'
import { pushPromptTrace, getAllPromptTraces, clearPromptTraces, subscribeTrace } from '../src/shared/prompt-trace'
import createAiGateway from '../src/db/gateways/ai'

function mockFetchOk() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'AI回复' } }] })
  }) as unknown as Response))
}

beforeEach(() => {
  setDebugMode(false)
  clearLogs()
  clearPromptTraces()
  mockFetchOk()
})

describe('log-buffer debug 门控', () => {
  it('debug 关时不采集 debug 级日志，info 正常采集', () => {
    pushLog('debug', 't', 'debug-msg')
    pushLog('info', 't', 'info-msg')
    const logs = getAllLogs()
    expect(logs.find((l) => l.level === 'debug')).toBeUndefined()
    expect(logs.find((l) => l.level === 'info')).toBeDefined()
  })

  it('debug 开时采集 debug 级日志', () => {
    setDebugMode(true)
    pushLog('debug', 't', 'debug-msg')
    expect(getAllLogs().find((l) => l.level === 'debug')).toBeDefined()
  })

  it('traceId 透传到 LogEntry', () => {
    setDebugMode(true)
    pushLog('debug', 't', 'm', 42)
    const entry = getAllLogs().find((l) => l.level === 'debug')!
    expect(entry.traceId).toBe(42)
  })

  it('LEVEL_ORDER 阈值顺序 debug<info<warn<error', () => {
    expect(LEVEL_ORDER.debug).toBeLessThan(LEVEL_ORDER.info)
    expect(LEVEL_ORDER.info).toBeLessThan(LEVEL_ORDER.warn)
    expect(LEVEL_ORDER.warn).toBeLessThan(LEVEL_ORDER.error)
  })
})

describe('prompt-trace 门控', () => {
  it('debug 关时 pushPromptTrace 返回 0 且不存储', () => {
    const id = pushPromptTrace({ scene: 'table-fill', model: 'm', segments: [{ role: 'user', content: 'x' }] })
    expect(id).toBe(0)
    expect(getAllPromptTraces()).toHaveLength(0)
  })

  it('debug 开时存储并返回正 id', () => {
    setDebugMode(true)
    const id = pushPromptTrace({ scene: 'table-fill', model: 'm', segments: [{ role: 'user', content: 'x' }] })
    expect(id).toBeGreaterThan(0)
    const traces = getAllPromptTraces()
    expect(traces).toHaveLength(1)
    expect(traces[0]!.scene).toBe('table-fill')
    expect(traces[0]!.segmentCount).toBe(1)
    expect(traces[0]!.segments[0]!.content).toBe('x')
  })

  it('上限 20 条 FIFO', () => {
    setDebugMode(true)
    for (let i = 0; i < 22; i++) {
      pushPromptTrace({ scene: 's' + i, model: 'm', segments: [] })
    }
    const traces = getAllPromptTraces()
    expect(traces).toHaveLength(20)
    expect(traces[0]!.scene).toBe('s2')
    expect(traces[traces.length - 1]!.scene).toBe('s21')
  })

  it('subscribeTrace 收到新 trace 通知', () => {
    setDebugMode(true)
    const received: number[] = []
    const unsub = subscribeTrace((entry) => received.push(entry.id))
    pushPromptTrace({ scene: 'x', model: 'm', segments: [] })
    expect(received).toHaveLength(1)
    unsub()
  })
})

describe('ai.ts 统一拦截', () => {
  it('debug 开时记录 trace 与 debug 索引日志', async () => {
    setDebugMode(true)
    const ai = createAiGateway()
    await ai.chatCompletion(
      [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'gpt-test' },
      undefined,
      { scene: 'table-fill' }
    )
    const traces = getAllPromptTraces()
    expect(traces).toHaveLength(1)
    expect(traces[0]!.scene).toBe('table-fill')
    expect(traces[0]!.model).toBe('gpt-test')
    expect(traces[0]!.segments).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' }
    ])
    expect(traces[0]!.segmentCount).toBe(2)
    const debugLogs = getAllLogs().filter((l) => l.level === 'debug' && l.tag === 'ai')
    expect(debugLogs).toHaveLength(1)
    expect(debugLogs[0]!.traceId).toBe(traces[0]!.id)
    expect(debugLogs[0]!.message).toContain('table-fill')
    expect(debugLogs[0]!.message).toContain('2 段')
  })

  it('debug 关时不采集 trace 与 debug 日志', async () => {
    const ai = createAiGateway()
    await ai.chatCompletion(
      [{ role: 'user', content: 'hi' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'm' }
    )
    expect(getAllPromptTraces()).toHaveLength(0)
    expect(getAllLogs().filter((l) => l.level === 'debug')).toHaveLength(0)
  })

  it('未传 scene 时默认 ai', async () => {
    setDebugMode(true)
    const ai = createAiGateway()
    await ai.chatCompletion(
      [{ role: 'user', content: 'hi' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'm' }
    )
    expect(getAllPromptTraces()[0]!.scene).toBe('ai')
  })
})
