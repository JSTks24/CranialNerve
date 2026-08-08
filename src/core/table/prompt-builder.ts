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

const MERGED_MAIN_HEADER = `你是【CranialNerve 填表AI】，负责根据故事内容同时执行两件事：更新数据库表格、为纪要表生成纪要。

## 输出结构（最高优先级，覆盖下方“表格更新要求”“纪要生成要求”中与本节冲突的表述）
- items 数组元素按对话楼层顺序排列，每个元素对应<正文数据>中的一轮（正文有几轮，items 就有几个元素），禁止把多轮合并进一个元素，禁止遗漏任何一轮
- 每个元素的 sql 字段必须同时包含两部分，二者同等重要、缺一不可：
  ① 该轮普通表的数据变更语句（多条语句用分号分隔；该轮没有需要修改的表时，本部分省略）
  ② 一条对纪要表 cn_chronicle 的 INSERT（**每轮必写**，**sql 字段不允许为空字符串**）
- **禁止以“该轮没有表格变化”为由省略实际存在的表格变更**；只有确认所有表都无变化时，才允许该轮只写纪要 INSERT
- 当该轮表格没有变更时，该元素只写纪要 INSERT，禁止留空、禁止省略纪要
- 纪要 INSERT 的 key 列必须显式写出且值任意，系统会自动改写为正确的楼层序号（CNxxxx），无需自行查最大序号
- 系统会自动按 SQL 内容分类：含 cn_chronicle 的语句归入纪要，含普通表的语句归入表格更新。你无需标注，只需把两类语句都写进同一个元素的 sql
- 禁止对纪要表使用 UPDATE/DELETE
- 禁止输出 CREATE/ALTER/DROP/SELECT/PRAGMA/BEGIN/COMMIT/ROLLBACK 等语句
- 输出单个 JSON 对象：{"format":"{{format}}","items":[{"sql":"..."}]}
- 若 API 启用了 JSON 限定格式（response_format: json_object），不要输出<thought>思考过程，只输出上述 JSON 对象
- 最后一个对象之后不要输出其他内容

## 输出示例（仅演示结构与规则，表名/列名/数值/内容均为虚构，实际以<正文数据>与下方真实表结构为准）
<正文数据>有两轮对话时的输出：

{"format":"{{format}}","items":[
  {"sql":"UPDATE hero SET hp = 80 WHERE name = '勇者'; INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0001', '第一轮剧情纪要正文。')"},
  {"sql":"INSERT INTO cn_chronicle (key, chronicle_text) VALUES ('CN0002', '第二轮剧情纪要正文。')"}
]}

- 示例第二个元素只有纪要 INSERT，对应“该轮表格无变更时只写纪要”的规则；第一个元素同时包含表格变更与纪要 INSERT
- 纪要正文的长度与写法以纪要表 Note 与【纪要生成要求】为准，示例仅演示结构`

function newSegId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function rewriteMergedSegment(content: string, scene: 'table' | 'chronicle'): string {
  const lines = content.split('\n')
  return lines.map((line) => {
    if (scene === 'table') {
      return line.replace(/[^，。；\n]*(?:sql[^，。；\n]*留空字符串|留空字符串[^，。；\n]*sql)[^，。；\n]*/, '该轮只写纪要 INSERT（merged 模式下 sql 字段不允许为空字符串）')
    }
    return line.replace(/[^。\n]*(?:最大序号|CNXXXX|CN000\d)[^。\n]*/, 'key 列必须显式写出且值任意，系统会自动改写为正确的楼层序号（CNxxxx），无需自行查最大序号')
  }).join('\n')
}

export function buildMergedPrompt(
  core: SqliteCore,
  options: BuildMergedPromptOptions
): PromptSegment[] {
  const tableSection = options.tableDefs
    .filter((t) => !options.targetTables || options.targetTables.includes(t.name))
    .map((t) => formatTableForAI(core, t, options.chronicleSendLatestRows ?? 10))
    .join('\n\n')
  const chronicleSection = formatTableForAI(core, options.chronicleTableDef, options.chronicleSendLatestRows)
  const vars = {
    format: SQL_EDIT_FORMAT,
    timeFormat: options.timeFormat ?? 'ISO 8601 格式（YYYY-MM-DDTHH:MM）',
    tables: tableSection,
    chronicleTable: chronicleSection,
    worldbook: options.worldbookContent ?? '',
    conversation: options.conversationText ?? '',
    persona: options.personaDescription ?? '',
    charDescription: options.charDescription ?? ''
  }

  const tableMain = options.tableSegments.find((s) => s.content.includes('{{tables}}'))
    ?? options.tableSegments.find((s) => s.name === '主指令')
  const chronicleMain = options.chronicleSegments.find((s) => s.content.includes('{{chronicleTable}}'))
    ?? options.chronicleSegments.find((s) => s.name === '主指令')
  const tableContent = tableMain ? rewriteMergedSegment(tableMain.content, 'table') : null
  const chronicleContent = chronicleMain ? rewriteMergedSegment(chronicleMain.content, 'chronicle') : null

  const mainParts = [MERGED_MAIN_HEADER]
  if (tableContent) mainParts.push('【表格更新要求】（与上方“输出结构”冲突处，以输出结构为准）', tableContent)
  if (chronicleContent) mainParts.push('【纪要生成要求】（与上方“输出结构”冲突处，以输出结构为准）', chronicleContent)
  if (!tableContent?.includes('{{tables}}')) {
    mainParts.push('## 当前数据库结构、数据与提示如下：\n{{tables}}')
  }
  if (!chronicleContent?.includes('{{chronicleTable}}')) {
    mainParts.push('## 当前纪要表结构、数据与提示如下：\n{{chronicleTable}}')
  }

  const mergedMain: PromptSegment = {
    id: newSegId('seg'),
    name: '主指令',
    role: 'system',
    content: interpolate(mainParts.join('\n'), vars)
  }
  const merged: PromptSegment[] = [mergedMain]
  const seen = new Set<string>([mergedMain.role + '\n' + mergedMain.content])
  for (const s of [...options.tableSegments, ...options.chronicleSegments]) {
    if (s === tableMain || s === chronicleMain) continue
    const filled = { ...s, content: interpolate(s.content, vars) }
    if (filled.content.trim().length === 0) continue
    const key = filled.role + '\n' + filled.content
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(filled)
    }
  }
  if (options.extraHint && options.extraHint.trim().length > 0) {
    merged.push({ id: newSegId('hint'), name: '额外提示', role: 'user', content: options.extraHint })
  }
  return merged
}
