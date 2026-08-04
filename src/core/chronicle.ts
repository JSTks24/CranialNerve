import type {
  AiGateway,
  ChatCompletionParams,
  AiClientConfig,
  AiChatMessage,
  AiCallOptions
} from '@db/gateways/ai'
import type { VectorGateway } from '@db/gateways/vector'
import type { PromptSegment, VectorConfig } from '@shared/types/config'
import { interpolate } from '@shared/prompts/interpolate'
import { computeTimeDelta, resolveStoryNowTime } from './time'
import type { ChronicleEntry } from '@shared/types/worldbook'
import type { VectorIndexStore, ChronicleVectorIndex } from './chronicle/vector-index-store'
import { sparseSearchBm25, reciprocalRankFusion } from './chronicle/bm25'

const VECTOR_TOP_K = 20

export type { ChronicleDraft } from './worldbook-entries'

export interface RecallContext {
  clientConfig: AiClientConfig
  params: ChatCompletionParams
  recallSegments: PromptSegment[]
  userMessage: string
  conversationText?: string
  personaDescription?: string
  charDescription?: string
  currentTime: string
  vectorEnabled: boolean
  vectorConfig: VectorConfig
  chatToken: string
  recallRecentFixedInjectCount: number
  recallMinScore: number
  signal?: AbortSignal
  callOptions?: AiCallOptions
}

export interface RecallItem {
  key: string
  entry: ChronicleEntry
  timeDeltaText: string
}

export interface ChronicleRecaller {
  recall(ctx: RecallContext): Promise<RecallItem[]>
}

export default function createChronicleRecaller(
  ai: AiGateway,
  getEntries: () => Promise<ChronicleEntry[]>,
  vector: VectorGateway,
  indexStore: VectorIndexStore
): ChronicleRecaller {
  return {
    async recall(ctx) {
      const all = await getEntries()
      if (all.length === 0) {
        return []
      }
      const index = await indexStore.ensureVectors(ctx.chatToken, all, vector, ctx.vectorConfig)
      const candidates = await prefilterByVector(vector, ctx, all, index)
      const keys = await filterRelevantKeys(ai, ctx, candidates)
      const recentKeys = getRecentKeys(all, ctx.recallRecentFixedInjectCount)
      const mergedKeys = [...new Set([...keys, ...recentKeys])]
      const referenceTime = resolveStoryNowTime(all) ?? ctx.currentTime
      const items: RecallItem[] = []
      for (const key of mergedKeys) {
        const entry = all.find((e) => e.key === key)
        if (!entry) {
          continue
        }
        items.push({
          key,
          entry,
          timeDeltaText: computeTimeDelta(ctx.chatToken, entry, referenceTime)
        })
      }
      return items
    }
  }
}

async function prefilterByVector(
  vector: VectorGateway,
  ctx: RecallContext,
  all: ChronicleEntry[],
  index: ChronicleVectorIndex
): Promise<ChronicleEntry[]> {
  if (!ctx.vectorEnabled) {
    return all
  }
  if (!ctx.vectorConfig.embeddingEndpoint || !ctx.vectorConfig.embeddingModel) {
    return all
  }
  try {
    const queryVec = (await vector.embed([ctx.userMessage], ctx.vectorConfig))[0]
    if (!queryVec || queryVec.length === 0) {
      return all
    }
    const indexMap = new Map(index.entries.map((e) => [e.key, e.vector]))
    const denseScored = all
      .map((entry) => {
        const score = cosine(queryVec, indexMap.get(entry.key) ?? [])
        return { key: entry.key, score, denseScore: score }
      })
      .filter((s) => s.score >= ctx.recallMinScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(VECTOR_TOP_K, all.length))
    const docs = all.map((e) => ({ key: e.key, text: e.content.summary ?? e.key }))
    const bm25Scored = sparseSearchBm25(ctx.userMessage, docs, Math.min(VECTOR_TOP_K, all.length))
    const fused = reciprocalRankFusion(
      [denseScored, bm25Scored],
      60,
      Math.min(VECTOR_TOP_K, all.length)
    )
    const fusedKeys = new Set(fused.map((f) => f.key))
    const candidates = all.filter((e) => fusedKeys.has(e.key))
    if (ctx.vectorConfig.rerankEndpoint && ctx.vectorConfig.rerankModel) {
      const candidateDocs = candidates.map((e) => e.content.summary ?? e.key)
      const order = await vector.rerank(ctx.userMessage, candidateDocs, ctx.vectorConfig)
      return order
        .map((idx) => candidates[idx])
        .filter((e): e is ChronicleEntry => e != null)
    }
    return candidates
  } catch {
    return all
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0
  }
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length && i < b.length; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    na += av * av
    nb += bv * bv
  }
  if (na === 0 || nb === 0) {
    return 0
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function parseTimeMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? undefined : ms
}

function getRecentKeys(entries: ChronicleEntry[], count: number): string[] {
  if (count <= 0 || entries.length === 0) return []
  const sorted = [...entries].sort((a, b) => {
    const ta = parseTimeMs(a.timeStart) ?? 0
    const tb = parseTimeMs(b.timeStart) ?? 0
    return tb - ta
  })
  return sorted.slice(0, count).map((e) => e.key)
}

async function filterRelevantKeys(
  ai: AiGateway,
  ctx: RecallContext,
  all: ChronicleEntry[]
): Promise<string[]> {
  const catalog = all.map((e) => ({
    key: e.key,
    summary: e.content.summary ?? '',
    storyTime: e.content.storyTime ?? ''
  }))
  const chronicleList = JSON.stringify(catalog)
  const userParts = [`玩家输入：${ctx.userMessage}`]
  if (ctx.personaDescription) {
    userParts.push(`用户人设：${ctx.personaDescription}`)
  }
  if (ctx.charDescription) {
    userParts.push(`角色设定：${ctx.charDescription}`)
  }
  if (ctx.conversationText) {
    userParts.push(`近期对话：${ctx.conversationText}`)
  }
  const messages: AiChatMessage[] = [
    ...ctx.recallSegments.map((s) => ({
      role: s.role,
      content: interpolate(s.content, {
        keyExample: 'CN0001',
        chronicleList,
        userInput: ctx.userMessage
      })
    })),
    { role: 'user', content: userParts.join('\n') }
  ]
  const raw = await ai.chatCompletion(messages, ctx.clientConfig, ctx.params, ctx.signal, ctx.callOptions)
  return parseKeys(raw)
}

function parseKeys(raw: string): string[] {
  const stripped = raw.replace(/<thought>[\s\S]*?<\/thought>/gi, '')
  const json = extractJson(stripped)
  if (!json) {
    return []
  }
  try {
    const obj = JSON.parse(json) as { keys?: unknown }
    return Array.isArray(obj.keys) ? obj.keys.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? trimmed).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return null
  }
  return candidate.slice(start, end + 1)
}
