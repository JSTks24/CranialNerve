import type SqliteCore from '@db/sqlite/core'
import type { PersistContext } from '@db/sqlite/frame-persist'
import type { AiClientConfig, AiGateway, AiCallOptions, ChatCompletionParams } from '@db/gateways/ai'
import type { TableEditSqlV1 } from '@shared/types/ai'
import type { PromptSegment } from '@shared/types/config'
import { SQL_EDIT_FORMAT } from '@shared/constants/sql-json'
import executeTableEditSql from './sql-executor'
import { buildFeedbackMessages } from './prompt-feedback'

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
}
export type FillProgressFn = (phase: FillPhase, detail?: FillProgressDetail) => void
export interface RunOptions {
  maxRetries: number
  signal?: AbortSignal
  onProgress?: FillProgressFn
}

export interface RunPersist {
  ctx: PersistContext
  messageId: number
}

export interface RunResult {
  ok: boolean
  attempts: number
  error?: string
  lastSql?: string
  errorCategory?: 'model' | 'infrastructure'
}

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
        attempt === 1 ? baseMessages : buildFeedbackMessages(baseMessages, lastRaw, lastError)
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
      const current = parseTableEditSql(raw)

      if (current) {
        options.onProgress?.('saving', { attempt, maxRetries: options.maxRetries })
        const persistArg = persist ? { ctx: persist.ctx, messageId: persist.messageId } : undefined
        const result = executeTableEditSql(this.core, current, persistArg)
        if (result.ok) {
          options.onProgress?.('complete', { attempt, maxRetries: options.maxRetries })
          return { ok: true, attempts: attempt, lastSql: current.sql }
        }
        lastError = result.error ?? 'unknown sql error'
        lastCategory = result.errorCategory ?? 'model'
      } else {
        lastError = `AI 输出 format 不是 ${SQL_EDIT_FORMAT}`
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

function parseTableEditSql(raw: string): TableEditSqlV1 | null {
  const stripped = raw.replace(/<thought>[\s\S]*?<\/thought>/gi, '')
  const jsonStrs = extractJsons(stripped)
  if (jsonStrs.length === 0) {
    return null
  }
  const sqls: string[] = []
  for (const jsonStr of jsonStrs) {
    try {
      const parsed = JSON.parse(jsonStr) as TableEditSqlV1
      if (parsed.format !== SQL_EDIT_FORMAT || typeof parsed.sql !== 'string') {
        continue
      }
      const s = parsed.sql.trim()
      if (s.length > 0) {
        sqls.push(s)
      }
    } catch {
      continue
    }
  }
  if (sqls.length === 0) {
    return null
  }
  if (sqls.length === 1) {
    return { format: SQL_EDIT_FORMAT, sql: sqls[0]! }
  }
  const normalized = sqls.map((s) => (s.endsWith(';') ? s : s + ';'))
  return { format: SQL_EDIT_FORMAT, sql: normalized.join('\n') }
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
