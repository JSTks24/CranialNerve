import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { CranialNerveSession } from '../src/core/session'
import type { AutoFillTrigger } from '../src/shared/types/config'
import {
  EVENT_GENERATION_AFTER_COMMANDS,
  EVENT_GENERATION_ENDED,
  EVENT_GENERATION_STARTED,
} from '../src/shared/constants/events'

function makeEventSource() {
  const lastHandlers = new Map<string, ((...args: unknown[]) => unknown)[]>()
  const onHandlers = new Map<string, ((...args: unknown[]) => unknown)[]>()
  return {
    makeLast(event: string, handler: (...args: unknown[]) => unknown) {
      const arr = lastHandlers.get(event) ?? []
      arr.push(handler)
      lastHandlers.set(event, arr)
    },
    on(event: string, handler: (...args: unknown[]) => unknown) {
      const arr = onHandlers.get(event) ?? []
      arr.push(handler)
      onHandlers.set(event, arr)
    },
    off() {},
    emit(event: string, ...args: unknown[]) {
      onHandlers.get(event)?.forEach((h) => h(...args))
      lastHandlers.get(event)?.forEach((h) => h(...args))
    },
  }
}

interface SetupOpts {
  chat: unknown[]
  eventSource: ReturnType<typeof makeEventSource>
  frequency: number
  trigger?: AutoFillTrigger
  regenerateFill?: boolean
}

function setupHost(opts: SetupOpts) {
  const ctx = {
    chat: opts.chat,
    eventSource: opts.eventSource,
    eventTypes: {},
    extensionSettings: {
      cranialnerve: {
        tableFill: {
          autoFillTrigger: opts.trigger ?? 'after-ai',
          regenerateFill: opts.regenerateFill ?? true,
          contextDepth: 3,
          updateFrequency: opts.frequency,
          batchSize: 3,
          skipFloors: 0,
          maxRetries: 3,
        },
        chronicleFill: {
          autoFillTrigger: 'off',
          regenerateFill: false,
        },
        pending: {
          aiCallTimeoutMs: 60000,
          aiTimeoutRetries: 1,
          listModelsTimeoutMs: 10000,
          writeQueueDrainTimeoutMs: 8000,
          summarizeOnManualAbort: false,
          minSummaryLength: 0,
        },
      },
    },
    characters: {},
    characterId: 0,
    chatId: 'test_chat',
    powerUserSettings: {},
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    SillyTavern: { getContext: () => ctx },
  }
}

interface SessionStub {
  syncBridge: unknown
  reloadForChatChange: () => Promise<void>
  getAiPresetForScene: () => null
  bindCoreEvents: () => void
  regenerateFillPending: boolean
  realGenerationPending: boolean
}

function stubSession(session: CranialNerveSession, removeFrame: ReturnType<typeof vi.fn>) {
  const stub = session as unknown as SessionStub
  stub.syncBridge = { getRepo: () => ({ removeFrame }) }
  stub.reloadForChatChange = vi.fn().mockResolvedValue(undefined)
  stub.getAiPresetForScene = vi.fn(() => null)
  stub.bindCoreEvents()
  return stub
}

describe('regenerate 事件时序（模拟酒馆 Generate）', () => {
  let originalWindow: unknown

  beforeEach(() => {
    originalWindow = (globalThis as unknown as { window?: unknown }).window
  })

  afterEach(() => {
    ;(globalThis as unknown as { window?: unknown }).window = originalWindow
  })

  it('regenerate 后清旧帧 + 强制总结（force 跳过 frequency）', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'old reply', extra: {} },
    ]
    const eventSource = makeEventSource()
    setupHost({ chat, eventSource, frequency: 2 })

    const session = new CranialNerveSession()
    const removeFrame = vi.fn()
    const getAiPresetForScene = vi.fn(() => null)
    const stub = stubSession(session, removeFrame)
    stub.getAiPresetForScene = getAiPresetForScene

    eventSource.emit(EVENT_GENERATION_STARTED, 'regenerate')
    eventSource.emit(EVENT_GENERATION_AFTER_COMMANDS, 'regenerate', {}, false)

    expect(removeFrame).toHaveBeenCalledWith(1)

    await vi.waitFor(() => {
      expect(stub.regenerateFillPending).toBe(true)
    })

    ;(chat[1] as { mes: string }).mes = 'brand new reply content'

    eventSource.emit(EVENT_GENERATION_ENDED, chat.length)

    await vi.waitFor(() => {
      expect(getAiPresetForScene).toHaveBeenCalled()
    })
  })

  it('非 regenerate 正常生成 + frequency 未达不总结', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'old', extra: {} },
    ]
    const eventSource = makeEventSource()
    setupHost({ chat, eventSource, frequency: 2 })

    const session = new CranialNerveSession()
    const getAiPresetForScene = vi.fn(() => null)
    const stub = stubSession(session, vi.fn())
    stub.getAiPresetForScene = getAiPresetForScene
    stub.realGenerationPending = true

    eventSource.emit(EVENT_GENERATION_STARTED, 'normal')
    ;(chat[1] as { mes: string }).mes = 'new content'
    eventSource.emit(EVENT_GENERATION_ENDED, chat.length)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('regenerate 但 trigger=off 仍不总结', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'old', extra: {} },
    ]
    const eventSource = makeEventSource()
    setupHost({ chat, eventSource, frequency: 2, trigger: 'off' })

    const session = new CranialNerveSession()
    const removeFrame = vi.fn()
    const getAiPresetForScene = vi.fn(() => null)
    const stub = stubSession(session, removeFrame)
    stub.getAiPresetForScene = getAiPresetForScene

    eventSource.emit(EVENT_GENERATION_STARTED, 'regenerate')
    eventSource.emit(EVENT_GENERATION_AFTER_COMMANDS, 'regenerate', {}, false)

    await vi.waitFor(() => {
      expect(stub.regenerateFillPending).toBe(true)
    })

    ;(chat[1] as { mes: string }).mes = 'brand new reply content'
    eventSource.emit(EVENT_GENERATION_ENDED, chat.length)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('after-send 模式 regenerate 不总结（等下次 message_sent）', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'old', extra: {} },
    ]
    const eventSource = makeEventSource()
    setupHost({ chat, eventSource, frequency: 1, trigger: 'after-send' })

    const session = new CranialNerveSession()
    const removeFrame = vi.fn()
    const getAiPresetForScene = vi.fn(() => null)
    const stub = stubSession(session, removeFrame)
    stub.getAiPresetForScene = getAiPresetForScene

    eventSource.emit(EVENT_GENERATION_STARTED, 'regenerate')
    eventSource.emit(EVENT_GENERATION_AFTER_COMMANDS, 'regenerate', {}, false)

    await vi.waitFor(() => {
      expect(stub.regenerateFillPending).toBe(true)
    })

    ;(chat[1] as { mes: string }).mes = 'brand new reply content'
    eventSource.emit(EVENT_GENERATION_ENDED, chat.length)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })

  it('after-ai 但 regenerateFill=false 时 regenerate 不总结', async () => {
    const chat = [
      { is_user: true, is_system: false, mes: 'hi', extra: {} },
      { is_user: false, is_system: false, mes: 'old', extra: {} },
    ]
    const eventSource = makeEventSource()
    setupHost({ chat, eventSource, frequency: 2, trigger: 'after-ai', regenerateFill: false })

    const session = new CranialNerveSession()
    const removeFrame = vi.fn()
    const getAiPresetForScene = vi.fn(() => null)
    const stub = stubSession(session, removeFrame)
    stub.getAiPresetForScene = getAiPresetForScene

    eventSource.emit(EVENT_GENERATION_STARTED, 'regenerate')
    eventSource.emit(EVENT_GENERATION_AFTER_COMMANDS, 'regenerate', {}, false)

    await vi.waitFor(() => {
      expect(stub.regenerateFillPending).toBe(true)
    })

    ;(chat[1] as { mes: string }).mes = 'brand new reply content'
    eventSource.emit(EVENT_GENERATION_ENDED, chat.length)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getAiPresetForScene).not.toHaveBeenCalled()
  })
})
