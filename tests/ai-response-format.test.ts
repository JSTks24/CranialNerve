import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../src/db/gateways/host-context', () => ({
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' })
}))
vi.mock('../src/shared/log-buffer', () => ({
  pushLog: () => {},
  isDebugMode: () => false
}))

import createAiGateway from '../src/db/gateways/ai'

function lastFetchBody(): Record<string, unknown> {
  const fetchFn = fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }
  const lastCall = fetchFn.mock.calls[fetchFn.mock.calls.length - 1]!
  return JSON.parse(lastCall[1].body as string) as Record<string, unknown>
}

describe('AiGateway responseFormat JSON 模式', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{}' } }] })
    }) as unknown as Response))
  })

  it('responseFormat=json_object 时注入 custom_include_body 含 response_format', async () => {
    const ai = createAiGateway()
    await ai.chatCompletion(
      [{ role: 'user', content: 'x' }],
      { baseURL: 'http://x', apiKey: 'k', responseFormat: 'json_object' },
      { model: 'm' }
    )
    const body = lastFetchBody()
    expect(body.custom_include_body).toBe(JSON.stringify({ response_format: { type: 'json_object' } }))
  })

  it('responseFormat=none 时不注入 custom_include_body', async () => {
    const ai = createAiGateway()
    await ai.chatCompletion(
      [{ role: 'user', content: 'x' }],
      { baseURL: 'http://x', apiKey: 'k', responseFormat: 'none' },
      { model: 'm' }
    )
    const body = lastFetchBody()
    expect(body.custom_include_body).toBeUndefined()
  })

  it('未设 responseFormat 时不注入', async () => {
    const ai = createAiGateway()
    await ai.chatCompletion(
      [{ role: 'user', content: 'x' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'm' }
    )
    const body = lastFetchBody()
    expect(body.custom_include_body).toBeUndefined()
  })
})
