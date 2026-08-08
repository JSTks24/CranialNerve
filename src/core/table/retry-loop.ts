import type SqliteCore from '@db/sqlite/core'
import type { PersistContext } from '@db/sqlite/frame-persist'
import type { AiClientConfig, AiGateway, AiCallOptions, ChatCompletionParams } from '@db/gateways/ai'
import type { TableEditSqlV1 } from '@shared/types/ai'
import type { PromptSegment } from '@shared/types/config'
import { SQL_EDIT_FORMAT } from '@shared/constants/sql-json'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import executeTableEditSql, { rewriteChronicleInsert } from './sql-executor'
import { buildFeedbackMessages } from './prompt-feedback'
import { sqlMentionsTable } from './sql-mentions'

export interface PromptContext {
  segments: PromptSegment[]
  userPrompt: string
  clientConfig: AiClientConfig
  params: ChatCompletionParams
  callOptions?: AiCallOptions
}

export type FillPhase = 'calling_ai' | 'parsing' | 'saving' | 'complete' | 'retry' | 'error'
export interface FillProgressDetail {
  attempt?: number
  maxRetries?: number
  error?: string
  currentBucket?: number
  totalBuckets?: number
  leg?: 'table' | 'chronicle'
}
export type FillProgressFn = (phase: FillPhase, detail?: FillProgressDetail) => void
export interface RunOptions {
  maxRetries: number
  signal?: AbortSignal
  onProgress?: FillProgressFn
  expectedSqlObjects?: number
  requireChronicleInsert?: boolean
  runMode?: 'table' | 'chronicle' | 'merged'
  floorSeqs?: (number | null)[]
}

export interface RunPersist {
  ctx: PersistContext
  messageId: number
}

export interface RunResult {
  ok: boolean
  attempts: number
  error?: string
  sqls?: string[]
  errorCategory?: 'model' | 'infrastructure'
}

export type ParseEditResult =
  | { ok: true; objects: TableEditSqlV1[] }
  | { ok: false; reason: string }

export default class TableEditor {
  private readonly core: SqliteCore
  private readonly ai: AiGateway

  constructor(core: SqliteCore, ai: AiGateway) {
    this.core = core
    this.ai = ai
  }

  async run(ctx: PromptContext, options: RunOptions, persist?: RunPersist): Promise<RunResult> {
    const baseMessages = [
      ...ctx.segments.map((s) => ({ role: s.role, content: s.content })),
      { role: 'user' as const, content: ctx.userPrompt }
    ]

    let lastError = ''
    let lastRaw = ''
    let lastCategory: 'model' | 'infrastructure' = 'model'
    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
      if (attempt > 1) {
        options.onProgress?.('retry', { attempt, maxRetries: options.maxRetries, error: lastError })
      }
      options.onProgress?.('calling_ai', { attempt, maxRetries: options.maxRetries })
      const messages =
        attempt === 1 ? baseMessages : buildFeedbackMessages(baseMessages, lastRaw, lastError, options.runMode)
      let raw: string
      try {
        raw = await this.ai.chatCompletion(
          messages,
          ctx.clientConfig,
          ctx.params,
          options.signal,
          ctx.callOptions
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        options.onProgress?.('error', { maxRetries: options.maxRetries, error: msg })
        return { ok: false, attempts: attempt, error: msg, errorCategory: 'infrastructure' }
      }
      lastRaw = raw
      options.onProgress?.('parsing', { attempt, maxRetries: options.maxRetries })
      const parsed = parseTableEditSql(raw, options.expectedSqlObjects)

      if (parsed.ok) {
        if (options.requireChronicleInsert) {
          const missingIdx = parsed.objects
            .map((o, i) => (sqlMentionsTable(o.sql, CHRONICLE_TABLE_NAME) ? -1 : i))
            .filter((i) => i >= 0)
          if (missingIdx.length > 0) {
            lastError = `第 ${missingIdx.map((i) => i + 1).join('、')} 个元素缺少对 ${CHRONICLE_TABLE_NAME} 表的 INSERT（每轮必写）`
            lastCategory = 'model'
            if (attempt < options.maxRetries) {
              await new Promise((resolve) => setTimeout(resolve, 5000))
            }
            continue
          }
        }
        options.onProgress?.('saving', { attempt, maxRetries: options.maxRetries })
        const persistArg = persist ? { ctx: persist.ctx, messageId: persist.messageId } : undefined
        // 纪要 key 系统改写：每层改用楼层绑定序号并转 REPLACE，重填覆盖不堆积。
        const edits = options.floorSeqs
          ? parsed.objects.map((o, k) => {
              const seq = options.floorSeqs![k]
              if (seq == null) return o
              if (!sqlMentionsTable(o.sql, CHRONICLE_TABLE_NAME)) return o
              const rewritten = rewriteChronicleInsert(o.sql, seq)
              return rewritten != null ? { ...o, sql: rewritten } : o
            })
          : parsed.objects
        const result = executeTableEditSql(this.core, edits, persistArg)
        if (result.ok) {
          options.onProgress?.('complete', { attempt, maxRetries: options.maxRetries })
          return { ok: true, attempts: attempt, sqls: edits.map((o) => o.sql) }
        }
        lastError = result.error ?? 'unknown sql error'
        lastCategory = result.errorCategory ?? 'model'
      } else {
        lastError = parsed.reason
        lastCategory = 'model'
      }

      if (attempt < options.maxRetries && lastCategory === 'model') {
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }
    }

    options.onProgress?.('error', { maxRetries: options.maxRetries, error: lastError })
    return { ok: false, attempts: options.maxRetries, error: lastError, errorCategory: lastCategory }
  }
}

export function parseTableEditSql(raw: string, expectedCount?: number): ParseEditResult {
  const stripped = raw.replace(/<thought>[\s\S]*?<\/thought>/gi, '')
  const jsonStrs = extractJsons(stripped)
  if (jsonStrs.length === 0) {
    return { ok: false, reason: '未找到 JSON 对象' }
  }
  const objects: TableEditSqlV1[] = []
  let invalid = false
  for (const jsonStr of jsonStrs) {
    try {
      const parsed = JSON.parse(jsonStr) as { format?: unknown; sql?: unknown; items?: Array<{ sql?: unknown }> }
      if (parsed.format !== SQL_EDIT_FORMAT) {
        invalid = true
        continue
      }
      if (Array.isArray(parsed.items)) {
        for (const item of parsed.items) {
          if (item && typeof item.sql === 'string') {
            objects.push({ format: SQL_EDIT_FORMAT, sql: item.sql.trim() })
          } else {
            invalid = true
          }
        }
      } else if (typeof parsed.sql === 'string') {
        objects.push({ format: SQL_EDIT_FORMAT, sql: parsed.sql.trim() })
      } else {
        invalid = true
      }
    } catch {
      invalid = true
    }
  }
  if (invalid) {
    return { ok: false, reason: `存在无效的 JSON 对象或 format 不是 ${SQL_EDIT_FORMAT}` }
  }
  if (expectedCount != null && objects.length !== expectedCount) {
    return { ok: false, reason: `需要 ${expectedCount} 个 JSON 对象（每轮正文一个），实际解析到 ${objects.length} 个` }
  }
  return { ok: true, objects }
}

function extractJsons(raw: string): string[] {
  const trimmed = raw.trim()
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  const candidates = fenced.length > 0 ? fenced.map((m) => m[1]!.trim()) : [trimmed]
  const results: string[] = []
  for (const candidate of candidates) {
    results.push(...extractTopLevelJsonObjects(candidate))
  }
  return results
}

function extractTopLevelJsonObjects(text: string): string[] {
  const results: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      if (depth === 0) {
        start = i
      }
      depth++
    } else if (ch === '}') {
      if (depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          results.push(text.slice(start, i + 1))
          start = -1
        }
      }
    }
  }
  return results
}
