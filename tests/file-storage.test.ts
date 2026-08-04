import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/db/gateways/host-context', () => ({
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' })
}))

import createFileStorageGateway from '../src/db/gateways/file-storage'

function mockFetch(response: Response): ReturnType<typeof vi.fn> {
  return vi.fn(async () => response)
}

describe('FileStorageGateway', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('save 调用 /api/files/upload 且带 name 与 data', async () => {
    const fetchMock = mockFetch(new Response('{}', { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const gw = createFileStorageGateway()
    await gw.save('test.json', '{"a":1}')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]!
    expect(call[0]).toBe('/api/files/upload')
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.name).toBe('test.json')
    expect(typeof body.data).toBe('string')
  })

  it('read 返回文件内容', async () => {
    const fetchMock = mockFetch(new Response('hello', { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const gw = createFileStorageGateway()
    const content = await gw.read('test.json')
    expect(content).toBe('hello')
  })

  it('read 404 返回 null', async () => {
    const fetchMock = mockFetch(new Response('', { status: 404 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const gw = createFileStorageGateway()
    const content = await gw.read('missing.json')
    expect(content).toBeNull()
  })

  it('delete 成功不抛错', async () => {
    const fetchMock = mockFetch(new Response('{}', { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const gw = createFileStorageGateway()
    await expect(gw.delete('test.json')).resolves.toBeUndefined()
  })
})
