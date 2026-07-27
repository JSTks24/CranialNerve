import type SqliteCore from '@db/sqlite/core'
import type { PersistContext } from '@db/sqlite/frame-persist'
import type { AiClientConfig, AiGateway, ChatCompletionParams } from '@db/gateways/ai'
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
}

export interface RunOptions {
  maxRetries: number
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
      const messages =
        attempt === 1 ? baseMessages : buildFeedbackMessages(baseMessages, lastRaw, lastError)
      const raw = await this.ai.chatCompletion(messages, ctx.clientConfig, ctx.params)
      lastRaw = raw
      const current = parseTableEditSql(raw)

      if (current) {
        const persistArg = persist ? { ctx: persist.ctx, messageId: persist.messageId } : undefined
        const result = executeTableEditSql(this.core, current, persistArg)
        if (result.ok) {
          return { ok: true, attempts: attempt, lastSql: current.sql }
        }
        lastError = result.error ?? 'unknown sql error'
      } else {
        lastError = `AI 输出 format 不是 ${SQL_EDIT_FORMAT}`
      }
    }

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
    if (parsed.format !== SQL_EDIT_FORMAT || typeof parsed.sql !== 'string') {
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
