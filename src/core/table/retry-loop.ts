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
    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
      if (attempt > 1) {
        options.onProgress?.('retry', { attempt, maxRetries: options.maxRetries, error: lastError })
      }
      options.onProgress?.('calling_ai', { attempt, maxRetries: options.maxRetries })
      const messages =
        attempt === 1 ? baseMessages : buildFeedbackMessages(baseMessages, lastRaw, lastError)
      const raw = await this.ai.chatCompletion(messages, ctx.clientConfig, ctx.params, options.signal, ctx.callOptions)
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
      } else {
        lastError = `AI 输出 format 不是 ${SQL_EDIT_FORMAT}`
      }
    }

    options.onProgress?.('error', { maxRetries: options.maxRetries, error: lastError })
    return { ok: false, attempts: options.maxRetries, error: lastError }
  }
}

function parseTableEditSql(raw: string): TableEditSqlV1 | null {
  const jsonStr = extractJson(raw)
  if (!jsonStr) {
    return null
  }
  try {
    const parsed = JSON.parse(jsonStr) as TableEditSqlV1
    if (parsed.format !== SQL_EDIT_FORMAT || typeof parsed.sql !== 'string' || parsed.sql.trim().length === 0) {
      return null
    }
    return parsed
  } catch {
    return null
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
