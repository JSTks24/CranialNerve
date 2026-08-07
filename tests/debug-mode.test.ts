import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../src/db/gateways/host-context', () => ({
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' })
}))

const sessionMock = vi.hoisted(() => ({
  isChatActive: vi.fn(() => false),
  worldbook: { listWorldbookNames: vi.fn(() => []) },
  getChatToken: vi.fn(() => ''),
  listTables: vi.fn(() => []),
  getTableRowsWithRowid: vi.fn(() => []),
  getLoadDiagnostic: vi.fn(() => ({})),
  listSnapshotIndices: vi.fn(() => []),
  getConfig: vi.fn(() => ({
    aiPresets: [],
    activeAiPresetId: null,
    recallEnabled: false,
    chronicleFill: {},
    tableFill: {},
    vectorEnabled: false
  })),
  recoverSnapshotAt: vi.fn(() => false),
  runWrite: vi.fn(),
  resetChatData: vi.fn(async () => {})
}))

vi.mock('../src/core/session', () => ({
  getSession: () => sessionMock
}))

vi.mock('../src/core/worldbook-sync', () => ({
  buildBookName: vi.fn(() => ''),
  cleanupStaleBooks: vi.fn(),
  syncToWorldbook: vi.fn()
}))

const fillMocks = vi.hoisted(() => ({
  isFillInProgress: vi.fn(() => false)
}))

vi.mock('../src/core/table/fill-orchestrator', () => fillMocks)

const toastMocks = vi.hoisted(() => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('@ui/toast', () => toastMocks)

import { pushLog, getAllLogs, clearLogs, setDebugMode, LEVEL_ORDER } from '../src/shared/log-buffer'
import { pushPromptTrace, getAllPromptTraces, clearPromptTraces, subscribeTrace, appendTraceResponse, MAX_TRACES } from '../src/shared/prompt-trace'
import createAiGateway from '../src/db/gateways/ai'
import { createPinia, setActivePinia } from 'pinia'
import { useDebugStore } from '../src/ui/stores/debug'

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
  sessionMock.resetChatData.mockClear()
  fillMocks.isFillInProgress.mockReset()
  fillMocks.isFillInProgress.mockReturnValue(false)
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

  it('上限 100 条 FIFO', () => {
    setDebugMode(true)
    for (let i = 0; i < MAX_TRACES + 2; i++) {
      pushPromptTrace({ scene: 's' + i, model: 'm', segments: [] })
    }
    const traces = getAllPromptTraces()
    expect(traces).toHaveLength(MAX_TRACES)
    expect(traces[0]!.scene).toBe('s2')
    expect(traces[traces.length - 1]!.scene).toBe('s' + (MAX_TRACES + 1))
  })

  it('subscribeTrace 收到新 trace 通知', () => {
    setDebugMode(true)
    const received: number[] = []
    const unsub = subscribeTrace((entry) => received.push(entry.id))
    pushPromptTrace({ scene: 'x', model: 'm', segments: [] })
    expect(received).toHaveLength(1)
    unsub()
  })

  it('appendTraceResponse debug 开时写入 response', () => {
    setDebugMode(true)
    const id = pushPromptTrace({ scene: 'x', model: 'm', segments: [] })
    appendTraceResponse(id, 'reply')
    expect(getAllPromptTraces()[0]!.response).toBe('reply')
  })

  it('appendTraceResponse debug 关时不写入', () => {
    setDebugMode(true)
    const id = pushPromptTrace({ scene: 'x', model: 'm', segments: [] })
    setDebugMode(false)
    appendTraceResponse(id, 'reply')
    expect(getAllPromptTraces()[0]!.response).toBeUndefined()
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
    const debugLogs = getAllLogs().filter((l) => l.level === 'debug' && l.tag === 'ai' && l.message.includes('已发送'))
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

  it('debug 开时记录 AI 回复到 trace.response 并发收到日志', async () => {
    setDebugMode(true)
    const ai = createAiGateway()
    await ai.chatCompletion(
      [{ role: 'user', content: 'hi' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'm' },
      undefined,
      { scene: 'table-fill' }
    )
    const trace = getAllPromptTraces()[0]!
    expect(trace.response).toBe('AI回复')
    const recvLogs = getAllLogs().filter((l) => l.level === 'debug' && l.tag === 'ai' && l.message.includes('收到回复'))
    expect(recvLogs).toHaveLength(1)
    expect(recvLogs[0]!.traceId).toBe(trace.id)
    expect(recvLogs[0]!.message).toContain('table-fill')
  })

  it('debug 关时不记录回复', async () => {
    const ai = createAiGateway()
    await ai.chatCompletion(
      [{ role: 'user', content: 'hi' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'm' }
    )
    expect(getAllPromptTraces()).toHaveLength(0)
    expect(getAllLogs().filter((l) => l.level === 'debug')).toHaveLength(0)
  })
})

describe('debug store 展开查找', () => {
  it('用 log.traceId 展开能正确匹配 trace', async () => {
    setDebugMode(true)
    setActivePinia(createPinia())
    const store = useDebugStore()
    pushLog('warn', 'other', '干扰日志')
    pushLog('info', 'other', '再插一条普通日志')
    const ai = createAiGateway()
    await ai.chatCompletion(
      [{ role: 'user', content: 'hi' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'm' }
    )
    const log = getAllLogs().find((l) => l.level === 'debug' && l.tag === 'ai')!
    const trace = getAllPromptTraces()[0]!
    expect(log.traceId).toBe(trace.id)
    store.toggleLogExpand(log.traceId!)
    expect(store.expandedTrace).not.toBeNull()
    expect(store.expandedTrace!.id).toBe(trace.id)
    expect(store.expandedTrace!.segments).toEqual(trace.segments)
  })

  it('trace 被 FIFO 淘汰后 expandedTrace 为 null', () => {
    setDebugMode(true)
    setActivePinia(createPinia())
    const store = useDebugStore()
    const ids: number[] = []
    for (let i = 0; i < MAX_TRACES + 1; i++) {
      ids.push(pushPromptTrace({ scene: 's' + i, model: 'm', segments: [] }))
    }
    const evictedId = ids[0]!
    const keptId = ids[ids.length - 1]!
    expect(getAllPromptTraces().find((t) => t.id === evictedId)).toBeUndefined()
    store.toggleLogExpand(evictedId)
    expect(store.expandedTrace).toBeNull()
    store.toggleLogExpand(keptId)
    expect(store.expandedTrace).not.toBeNull()
    expect(store.expandedTrace!.id).toBe(keptId)
  })

  it('toggleLogExpand 再次点击同一 traceId 可收起', () => {
    setDebugMode(true)
    setActivePinia(createPinia())
    const store = useDebugStore()
    const id = pushPromptTrace({ scene: 'x', model: 'm', segments: [] })
    store.toggleLogExpand(id)
    expect(store.expandedTrace).not.toBeNull()
    store.toggleLogExpand(id)
    expect(store.expandedTrace).toBeNull()
  })
})

describe('debug store 调试模式与 levelFilter 联动', () => {
  it('开启调试模式时 levelFilter 自动切到 debug', () => {
    setActivePinia(createPinia())
    const store = useDebugStore()
    expect(store.levelFilter).toBe('warn')
    store.toggleDebugMode()
    expect(store.debugMode).toBe(true)
    expect(store.levelFilter).toBe('debug')
  })

  it('关闭调试模式时 levelFilter 恢复 warn', () => {
    setActivePinia(createPinia())
    const store = useDebugStore()
    store.toggleDebugMode()
    store.toggleDebugMode()
    expect(store.debugMode).toBe(false)
    expect(store.levelFilter).toBe('warn')
  })

  it('开启后手动调成 info，关闭时仍恢复 warn', () => {
    setActivePinia(createPinia())
    const store = useDebugStore()
    store.toggleDebugMode()
    store.levelFilter = 'info'
    store.toggleDebugMode()
    expect(store.levelFilter).toBe('warn')
  })

  it('开启调试模式后 debug 级 AI 日志进入可见列表', async () => {
    setActivePinia(createPinia())
    const store = useDebugStore()
    store.toggleDebugMode()
    const ai = createAiGateway()
    await ai.chatCompletion(
      [{ role: 'user', content: 'hi' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'm' },
      undefined,
      { scene: 'table-fill' }
    )
    store.refresh()
    const aiLog = store.visibleLogs.find((l) => l.tag === 'ai' && l.level === 'debug')
    expect(aiLog).toBeDefined()
    expect(aiLog!.message).toContain('table-fill')
    expect(aiLog!.traceId).toBeTruthy()
  })
})

describe('debug store 彻底清空', () => {
  it('resetChatData 调 session.resetChatData 并刷新状态', async () => {
    setActivePinia(createPinia())
    const store = useDebugStore()
    await store.resetChatData()
    expect(sessionMock.resetChatData).toHaveBeenCalledTimes(1)
    expect(sessionMock.isChatActive).toHaveBeenCalled()
  })

  it('填表进行中时阻止清空并 toast 提示', async () => {
    fillMocks.isFillInProgress.mockReturnValue(true)
    setActivePinia(createPinia())
    const store = useDebugStore()
    await store.resetChatData()
    expect(sessionMock.resetChatData).not.toHaveBeenCalled()
    expect(toastMocks.default.warning).toHaveBeenCalled()
  })
})
