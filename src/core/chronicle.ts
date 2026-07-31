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
  vector: VectorGateway
): ChronicleRecaller {
  return {
    async recall(ctx) {
      const all = await getEntries()
      if (all.length === 0) {
        return []
      }
      const candidates = await prefilterByVector(vector, ctx, all)
      const keys = await filterRelevantKeys(ai, ctx, candidates)
      const referenceTime = resolveStoryNowTime(all) ?? ctx.currentTime
      const items: RecallItem[] = []
      for (const key of keys) {
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
  all: ChronicleEntry[]
): Promise<ChronicleEntry[]> {
  if (!ctx.vectorEnabled) {
    return all
  }
  if (!ctx.vectorConfig.embeddingEndpoint || !ctx.vectorConfig.embeddingModel) {
    return all
  }
  try {
    const docs = all.map((e) => e.content.summary ?? e.key)
    const [queryVec, ...docVecs] = await vector.embed([ctx.userMessage, ...docs], ctx.vectorConfig)
    if (!queryVec || queryVec.length === 0) {
      return all
    }
    const scored = docVecs.map((vec, i) => ({
      entry: all[i] as ChronicleEntry,
      score: cosine(queryVec, vec)
    }))
    if (ctx.vectorConfig.rerankEndpoint && ctx.vectorConfig.rerankModel) {
      const order = await vector.rerank(ctx.userMessage, docs, ctx.vectorConfig)
      return order.map((idx) => all[idx]).filter((e): e is ChronicleEntry => e != null)
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(VECTOR_TOP_K, all.length))
      .map((s) => s.entry)
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
  const json = extractJson(raw)
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
