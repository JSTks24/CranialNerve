import type SqliteCore from '@db/sqlite/core'
import type { PromptSegment } from '@shared/types/config'
import type { TableDef } from '@shared/types/table'
import { buildCreateTableSql } from '@shared/template-builder'
import { SQL_EDIT_FORMAT } from '@shared/constants/sql-json'
import { interpolate } from '@shared/prompts/interpolate'

export interface BuildPromptOptions {
  tableDefs: TableDef[]
  targetTables?: string[]
  worldbookContent?: string
  conversationText?: string
  timeFormat?: string
  segments: PromptSegment[]
  extraHint?: string
  chronicleGuide?: string
}

export function buildTableEditPrompt(
  core: SqliteCore,
  options: BuildPromptOptions
): PromptSegment[] {
  const tableSection = options.tableDefs
    .filter((t) => !options.targetTables || options.targetTables.includes(t.name))
    .map((t) => formatTableForAI(core, t))
    .join('\n\n')

  const filled = cloneSegments(options.segments).map((s) => ({
    ...s,
    content: interpolate(s.content, {
      format: SQL_EDIT_FORMAT,
      timeFormat: options.timeFormat ?? 'ISO 8601 格式（YYYY-MM-DDTHH:MM）',
      tables: tableSection,
      worldbook: options.worldbookContent ?? '',
      conversation: options.conversationText ?? '',
      chronicleGuide: options.chronicleGuide ?? ''
    })
  }))

  if (options.extraHint && options.extraHint.trim().length > 0) {
    filled.push({ id: 'hint_' + Math.random().toString(36).slice(2, 10), name: '额外提示', role: 'user', content: options.extraHint })
  }

  return filled
}

function cloneSegments(segments: PromptSegment[]): PromptSegment[] {
  return segments.map((s) => ({ ...s }))
}

function formatTableForAI(core: SqliteCore, table: TableDef): string {
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
    const rows = result.length > 0 ? (result[0]?.rows ?? []) : []
    lines.push(`-- 当前数据 (${rows.length} 行):`)
    lines.push(`-- ${JSON.stringify(rows)}`)
  } catch {
    lines.push('-- 当前数据: 读取失败')
  }

  return lines.join('\n')
}
