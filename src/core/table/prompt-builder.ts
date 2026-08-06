import type SqliteCore from '@db/sqlite/core'
import type { PromptSegment } from '@shared/types/config'
import type { TableDef } from '@shared/types/table'
import { buildCreateTableSql } from '@shared/template-builder'
import { SQL_EDIT_FORMAT } from '@shared/constants/sql-json'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import { interpolate } from '@shared/prompts/interpolate'

export interface BuildPromptOptions {
  tableDefs: TableDef[]
  targetTables?: string[]
  worldbookContent?: string
  conversationText?: string
  timeFormat?: string
  segments: PromptSegment[]
  extraHint?: string
  personaDescription?: string
  charDescription?: string
  chronicleSendLatestRows?: number
}

export function buildTableEditPrompt(
  core: SqliteCore,
  options: BuildPromptOptions
): PromptSegment[] {
  const tableSection = options.tableDefs
    .filter((t) => !options.targetTables || options.targetTables.includes(t.name))
    .map((t) => formatTableForAI(core, t, options.chronicleSendLatestRows ?? 10))
    .join('\n\n')

  const filled = cloneSegments(options.segments).map((s) => ({
    ...s,
    content: interpolate(s.content, {
      format: SQL_EDIT_FORMAT,
      timeFormat: options.timeFormat ?? 'ISO 8601 格式（YYYY-MM-DDTHH:MM）',
      tables: tableSection,
      worldbook: options.worldbookContent ?? '',
      conversation: options.conversationText ?? '',
      persona: options.personaDescription ?? '',
      charDescription: options.charDescription ?? ''
    })
  })).filter((s) => s.content.trim().length > 0)

  if (options.extraHint && options.extraHint.trim().length > 0) {
    filled.push({ id: 'hint_' + Math.random().toString(36).slice(2, 10), name: '额外提示', role: 'user', content: options.extraHint })
  }

  return filled
}

function cloneSegments(segments: PromptSegment[]): PromptSegment[] {
  return segments.map((s) => ({ ...s }))
}

function formatTableForAI(
  core: SqliteCore,
  table: TableDef,
  chronicleSendLatestRows: number
): string {
  const ddl = buildCreateTableSql(table)
  const lines: string[] = [`-- 表: ${table.displayName} (${table.name})`]
  lines.push('-- DDL:')
  lines.push(`-- ${ddl.replace(/\n/g, '\n-- ')}`)

  if (table.note) {
    lines.push(`-- Note: ${table.note.replace(/\n/g, '\n-- ')}`)
  }
  if (table.insertHint) {
    lines.push(`-- INSERT 提示: ${table.insertHint.replace(/\n/g, '\n-- ')}`)
  }
  if (table.updateHint) {
    lines.push(`-- UPDATE 提示: ${table.updateHint.replace(/\n/g, '\n-- ')}`)
  }
  if (table.deleteHint) {
    lines.push(`-- DELETE 提示: ${table.deleteHint.replace(/\n/g, '\n-- ')}`)
  }
  for (const col of table.columns) {
    if (col.note) {
      lines.push(`-- 列 ${col.displayName}(${col.name}): ${col.note.replace(/\n/g, '\n-- ')}`)
    }
  }

  try {
    const result = core.exec(`SELECT * FROM "${table.name.replace(/"/g, '""')}"`)
    const allRows = result.length > 0 ? (result[0]?.rows ?? []) : []
    const limit = resolveRowLimit(table, chronicleSendLatestRows)
    const { rows, note } = applyRowLimit(allRows, limit)
    if (note) {
      lines.push(`-- Note: ${note}`)
    }
    lines.push(`-- 当前数据 (${rows.length} rows):`)
    if (rows.length > 0) {
      const headers = table.columns.map((c) => c.name)
      lines.push(`-- | ${headers.join(' | ')} |`)
      for (const row of rows) {
        const values = table.columns.map((c) => formatCell(row[c.name]))
        lines.push(`-- | ${values.join(' | ')} |`)
      }
    }
  } catch {
    lines.push('-- 当前数据: 读取失败')
  }

  return lines.join('\n')
}

function resolveRowLimit(table: TableDef, chronicleSendLatestRows: number): number {
  if (table.name === CHRONICLE_TABLE_NAME) {
    return chronicleSendLatestRows > 0 ? chronicleSendLatestRows : -1
  }
  const configured = table.updateConfig?.sendLatestRows
  return typeof configured === 'number' ? configured : -1
}

function applyRowLimit(
  allRows: Record<string, unknown>[],
  limit: number
): { rows: Record<string, unknown>[]; note: string } {
  if (limit > 0 && allRows.length > limit) {
    return {
      rows: allRows.slice(-limit),
      note: `Showing last ${limit} of ${allRows.length} entries`
    }
  }
  return { rows: allRows, note: '' }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).replace(/\n/g, ' ')
}

export interface BuildChronicleGenOptions {
  chronicleTableDef: TableDef
  chronicleSendLatestRows: number
  worldbookContent?: string
  conversationText?: string
  timeFormat?: string
  segments: PromptSegment[]
  extraHint?: string
  personaDescription?: string
  charDescription?: string
}

export function buildChronicleGenPrompt(
  core: SqliteCore,
  options: BuildChronicleGenOptions
): PromptSegment[] {
  const chronicleSection = formatTableForAI(core, options.chronicleTableDef, options.chronicleSendLatestRows)
  const filled = cloneSegments(options.segments).map((s) => ({
    ...s,
    content: interpolate(s.content, {
      format: SQL_EDIT_FORMAT,
      timeFormat: options.timeFormat ?? 'ISO 8601 格式（YYYY-MM-DDTHH:MM）',
      chronicleTable: chronicleSection,
      worldbook: options.worldbookContent ?? '',
      conversation: options.conversationText ?? '',
      persona: options.personaDescription ?? '',
      charDescription: options.charDescription ?? ''
    })
  })).filter((s) => s.content.trim().length > 0)

  if (options.extraHint && options.extraHint.trim().length > 0) {
    filled.push({ id: 'hint_' + Math.random().toString(36).slice(2, 10), name: '额外提示', role: 'user', content: options.extraHint })
  }

  return filled
}

export interface BuildMergedPromptOptions {
  tableDefs: TableDef[]
  targetTables?: string[]
  chronicleTableDef: TableDef
  chronicleSendLatestRows: number
  worldbookContent?: string
  conversationText?: string
  timeFormat?: string
  tableSegments: PromptSegment[]
  chronicleSegments: PromptSegment[]
  extraHint?: string
  personaDescription?: string
  charDescription?: string
}

export function buildMergedPrompt(
  core: SqliteCore,
  options: BuildMergedPromptOptions
): PromptSegment[] {
  const tableSegs = buildTableEditPrompt(core, {
    tableDefs: options.tableDefs,
    targetTables: options.targetTables,
    worldbookContent: options.worldbookContent,
    conversationText: options.conversationText,
    timeFormat: options.timeFormat,
    segments: options.tableSegments,
    extraHint: options.extraHint,
    personaDescription: options.personaDescription,
    charDescription: options.charDescription
  })
  const chronicleSegs = buildChronicleGenPrompt(core, {
    chronicleTableDef: options.chronicleTableDef,
    chronicleSendLatestRows: options.chronicleSendLatestRows,
    worldbookContent: options.worldbookContent,
    conversationText: options.conversationText,
    timeFormat: options.timeFormat,
    segments: options.chronicleSegments,
    personaDescription: options.personaDescription,
    charDescription: options.charDescription
  })
  const seen = new Set<string>()
  const merged: PromptSegment[] = []
  for (const s of [...tableSegs, ...chronicleSegs]) {
    const key = s.role + '\n' + s.content
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(s)
    }
  }
  return merged
}
