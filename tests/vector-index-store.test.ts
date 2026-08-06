import { describe, expect, it, vi } from 'vitest'
import createVectorIndexStore, { buildFingerprint } from '../src/core/chronicle/vector-index-store'
import { buildSearchableText } from '../src/core/chronicle/searchable-text'
import type { ChronicleEntry } from '../src/shared/types/worldbook'
import type { FileStorageGateway } from '../src/db/gateways/file-storage'
import type { VectorGateway } from '../src/db/gateways/vector'
import type { VectorConfig } from '../src/shared/types/config'

function entry(key: string, summary = '', location = ''): ChronicleEntry {
  return { key, content: { summary, location } }
}

function makeFileStorage(initial: string | null = null): FileStorageGateway & {
  saved: string[]
} {
  let stored = initial
  const saved: string[] = []
  const fs = {
    saved,
    async save(_name: string, content: string) {
      stored = content
      saved.push(content)
    },
    async read(_name: string) {
      return stored
    },
    async delete(_name: string) {
      stored = null
    }
  }
  return fs as FileStorageGateway & { saved: string[] }
}

const vectorConfig: VectorConfig = {
  embeddingEndpoint: 'http://e',
  embeddingApiKey: '',
  embeddingModel: 'm',
  rerankEndpoint: '',
  rerankApiKey: '',
  rerankModel: ''
}

function makeVector(): VectorGateway {
  return {
    embed: vi.fn(async (texts: string[]) => texts.map((_, i) => [i, i + 0.1])),
    rerank: vi.fn(async () => [])
  }
}

describe('buildFingerprint', () => {
  it('相同内容相同 fingerprint', () => {
    expect(buildFingerprint(entry('k1', 's', 'l'))).toBe(buildFingerprint(entry('k1', 's', 'l')))
  })
  it('不同 summary 不同 fingerprint', () => {
    expect(buildFingerprint(entry('k1', 's1', 'l'))).not.toBe(buildFingerprint(entry('k1', 's2', 'l')))
  })
  it('不同 importantWord 不同 fingerprint', () => {
    const e1: ChronicleEntry = { key: 'k1', content: { summary: 's', location: 'l', importantWord: 'd1' } }
    const e2: ChronicleEntry = { key: 'k1', content: { summary: 's', location: 'l', importantWord: 'd2' } }
    expect(buildFingerprint(e1)).not.toBe(buildFingerprint(e2))
  })
})

describe('VectorIndexStore ensureVectors', () => {
  it('首次全量 embed 并持久化', async () => {
    const fs = makeFileStorage()
    const vector = makeVector()
    const store = createVectorIndexStore(fs)
    const index = await store.ensureVectors(
      'tok',
      [entry('k1', 's1'), entry('k2', 's2')],
      vector,
      vectorConfig
    )
    expect(index.entries).toHaveLength(2)
    expect(vector.embed).toHaveBeenCalledTimes(1)
    expect(fs.saved).toHaveLength(1)
  })

  it('未变更的条目复用向量，不重复 embed', async () => {
    const fs = makeFileStorage()
    const vector = makeVector()
    const store = createVectorIndexStore(fs)
    await store.ensureVectors('tok', [entry('k1', 's1'), entry('k2', 's2')], vector, vectorConfig)
    const embedCalls = (vector.embed as ReturnType<typeof vi.fn>).mock.calls.length
    await store.ensureVectors('tok', [entry('k1', 's1'), entry('k2', 's2')], vector, vectorConfig)
    expect((vector.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(embedCalls)
  })

  it('变更的条目重新 embed', async () => {
    const fs = makeFileStorage()
    const vector = makeVector()
    const store = createVectorIndexStore(fs)
    await store.ensureVectors('tok', [entry('k1', 's1')], vector, vectorConfig)
    await store.ensureVectors('tok', [entry('k1', 's1-changed')], vector, vectorConfig)
    expect((vector.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it('已删除的条目从索引移除', async () => {
    const fs = makeFileStorage()
    const vector = makeVector()
    const store = createVectorIndexStore(fs)
    await store.ensureVectors('tok', [entry('k1'), entry('k2')], vector, vectorConfig)
    const index = await store.ensureVectors('tok', [entry('k1')], vector, vectorConfig)
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]?.key).toBe('k1')
  })

  it('新增条目增量 embed', async () => {
    const fs = makeFileStorage()
    const vector = makeVector()
    const store = createVectorIndexStore(fs)
    await store.ensureVectors('tok', [entry('k1', 's1')], vector, vectorConfig)
    const index = await store.ensureVectors(
      'tok',
      [entry('k1', 's1'), entry('k2', 's2')],
      vector,
      vectorConfig
    )
    expect(index.entries).toHaveLength(2)
    expect((vector.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it('importantWord 变化触发重新 embed', async () => {
    const fs = makeFileStorage()
    const vector = makeVector()
    const store = createVectorIndexStore(fs)
    await store.ensureVectors('tok', [entry('k1', 's1', 'l')], vector, vectorConfig)
    await store.ensureVectors(
      'tok',
      [{ key: 'k1', content: { summary: 's1', location: 'l', importantWord: 'd' } }],
      vector,
      vectorConfig
    )
    expect((vector.embed as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  it('INDEX_VERSION 不匹配触发全量重建', async () => {
    const oldIndex = JSON.stringify({
      version: 2,
      chatToken: 'tok',
      entries: [{ key: 'k1', fingerprint: 'x', vector: [1, 2] }]
    })
    const fs = makeFileStorage(oldIndex)
    const vector = makeVector()
    const store = createVectorIndexStore(fs)
    const index = await store.ensureVectors('tok', [entry('k1', 's1')], vector, vectorConfig)
    expect(index.version).toBe(3)
    expect(vector.embed).toHaveBeenCalledTimes(1)
    expect(index.entries[0]?.vector).toEqual([0, 0.1])
  })
})

describe('buildSearchableText', () => {
  it('拼接 summary/location/importantWord', () => {
    const e: ChronicleEntry = { key: 'k1', content: { summary: 's', location: 'l', importantWord: 'd' } }
    expect(buildSearchableText(e)).toBe('s\nl\nd')
  })
  it('跳过空字段', () => {
    const e: ChronicleEntry = { key: 'k1', content: { summary: 's', location: '', importantWord: undefined } }
    expect(buildSearchableText(e)).toBe('s')
  })
  it('全空回退到 key', () => {
    const e: ChronicleEntry = { key: 'k1', content: {} }
    expect(buildSearchableText(e)).toBe('k1')
  })
})
