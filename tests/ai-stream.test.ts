import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/db/gateways/host-context', () => ({
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' })
}))
vi.mock('../src/shared/log-buffer', () => ({
  pushLog: () => {},
  isDebugMode: () => false
}))

import createAiGateway from '../src/db/gateways/ai'

function streamResponse(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    }
  })
  return { ok: true, body: stream } as unknown as Response
}

describe('AiGateway SSE 流式跨 chunk 行拼接（3.1 修复：不丢失被网络分块的 data 行）', () => {
  it('跨 chunk 的 data 行内容完整拼接', async () => {
    const chunks = [
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你'),
      new TextEncoder().encode('好"}}]}\n\n'),
      new TextEncoder().encode('data: [DONE]\n\n'),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(chunks)))
    const ai = createAiGateway()
    const content = await ai.chatCompletion(
      [{ role: 'user', content: 'x' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'm', stream: true }
    )
    expect(content).toBe('你好')
  })

  it('data: 无空格前缀也能解析', async () => {
    const chunks = [
      new TextEncoder().encode('data:{"choices":[{"delta":{"content":"X"}}]}\n\ndata: [DONE]\n\n'),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(chunks)))
    const ai = createAiGateway()
    const content = await ai.chatCompletion(
      [{ role: 'user', content: 'x' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'm', stream: true }
    )
    expect(content).toBe('X')
  })

  it('多个完整 data 行 delta 累加', async () => {
    const chunks = [
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"A"}}]}\n\n'),
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"B"}}]}\n\n'),
      new TextEncoder().encode('data: [DONE]\n\n'),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(chunks)))
    const ai = createAiGateway()
    const content = await ai.chatCompletion(
      [{ role: 'user', content: 'x' }],
      { baseURL: 'http://x', apiKey: 'k' },
      { model: 'm', stream: true }
    )
    expect(content).toBe('AB')
  })
})
