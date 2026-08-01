import { describe, expect, it, afterEach } from 'vitest'
import { registerGenerateInterceptor } from '../src/core/chronicle/generate-interceptor'
import { RECALL_FADE_MIN_DEPTH } from '../src/shared/constants'

const GLOBAL_KEY = 'cnGenerateInterceptor'

type ChatItem = { is_user?: boolean; mes?: unknown }

describe('RECALL_FADE_MIN_DEPTH', () => {
  it('为 2，对齐 WI scan_depth 默认值', () => {
    expect(RECALL_FADE_MIN_DEPTH).toBe(2)
  })
})

describe('cnGenerateInterceptor', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[GLOBAL_KEY]
  })

  it('注册后挂载到 globalThis 为函数', () => {
    registerGenerateInterceptor()
    expect(typeof (globalThis as Record<string, unknown>)[GLOBAL_KEY]).toBe('function')
  })

  it('depth >= 2 的用户消息剥离 keys，depth < 2 保留', () => {
    registerGenerateInterceptor()
    const fn = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as (chat: ChatItem[]) => void

    const chat: ChatItem[] = [
      { is_user: true, mes: 'CN0001 CN0002\ndepth4' },
      { is_user: false, mes: 'AI1' },
      { is_user: true, mes: 'CN0003\ndepth2' },
      { is_user: false, mes: 'AI2' },
      { is_user: true, mes: 'CN0004 CN0005\ndepth0' },
    ]

    fn(chat)

    expect(chat[0]!.mes).toBe('depth4')
    expect(chat[2]!.mes).toBe('depth2')
    expect(chat[4]!.mes).toBe('CN0004 CN0005\ndepth0')
    expect(chat[1]!.mes).toBe('AI1')
    expect(chat[3]!.mes).toBe('AI2')
  })

  it('depth=1 边界保留，depth=2 边界剥离', () => {
    registerGenerateInterceptor()
    const fn = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as (chat: ChatItem[]) => void
    const chat: ChatItem[] = [
      { is_user: true, mes: 'CN0001\ndepth2' },
      { is_user: true, mes: 'CN0002\ndepth1' },
      { is_user: true, mes: 'CN0003\ndepth0' },
    ]
    fn(chat)
    expect(chat[0]!.mes).toBe('depth2')
    expect(chat[1]!.mes).toBe('CN0002\ndepth1')
    expect(chat[2]!.mes).toBe('CN0003\ndepth0')
  })

  it('非用户消息即使含 keys 也不剥离', () => {
    registerGenerateInterceptor()
    const fn = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as (chat: ChatItem[]) => void
    const chat: ChatItem[] = [
      { is_user: false, mes: 'CN0001\nAI老消息' },
      { is_user: false, mes: 'AI2' },
      { is_user: true, mes: '用户' },
    ]
    fn(chat)
    expect(chat[0]!.mes).toBe('CN0001\nAI老消息')
  })

  it('mes 非 string 不报错且不变', () => {
    registerGenerateInterceptor()
    const fn = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as (chat: ChatItem[]) => void
    const chat: ChatItem[] = [
      { is_user: true, mes: 123 },
      { is_user: false, mes: 'AI' },
      { is_user: true, mes: 'CN0001\n用户' },
    ]
    expect(() => fn(chat)).not.toThrow()
    expect(chat[0]!.mes).toBe(123)
    expect(chat[2]!.mes).toBe('CN0001\n用户')
  })

  it('无 keys 行的用户消息不变', () => {
    registerGenerateInterceptor()
    const fn = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as (chat: ChatItem[]) => void
    const chat: ChatItem[] = [
      { is_user: true, mes: '普通老消息' },
      { is_user: false, mes: 'AI' },
      { is_user: true, mes: '用户' },
    ]
    fn(chat)
    expect(chat[0]!.mes).toBe('普通老消息')
  })

  it('原位修改同一数组对象，不创建新数组', () => {
    registerGenerateInterceptor()
    const fn = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as (chat: ChatItem[]) => void
    const chat: ChatItem[] = [
      { is_user: true, mes: 'CN0001\n老消息' },
      { is_user: false, mes: 'AI' },
      { is_user: true, mes: '用户' },
    ]
    const originalRef = chat[0]
    fn(chat)
    expect(chat[0]).toBe(originalRef)
    expect(chat[0]!.mes).toBe('老消息')
  })
})
