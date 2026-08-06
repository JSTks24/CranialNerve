import type { CardTemplate } from '@shared/types/card'
import type { TableDef, ColumnDef } from '@shared/types/table'
import type { TableTemplatePreset } from '@shared/types/config'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

interface ShujukuSheet {
  uid?: string
  name?: string
  sourceData?: {
    note?: string
    initNode?: string
    deleteNode?: string
    updateNode?: string
    insertNode?: string
    ddl?: string
  }
  content?: (string | null)[][]
  updateConfig?: Record<string, unknown>
  exportConfig?: Record<string, unknown>
  orderNo?: number
}

interface ShujukuTemplate {
  mate?: Record<string, unknown>
  [key: string]: unknown
}

export function isShujukuTemplate(obj: unknown): obj is ShujukuTemplate {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const keys = Object.keys(obj as Record<string, unknown>)
  const sheetKeys = keys.filter((k) => k.startsWith('sheet_'))
  if (sheetKeys.length === 0) return false
  const first = (obj as Record<string, unknown>)[sheetKeys[0]!]
  if (!first || typeof first !== 'object') return false
  return typeof (first as Record<string, unknown>).sourceData === 'object'
}

export function isCardTemplate(obj: unknown): obj is CardTemplate {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const t = obj as Record<string, unknown>
  return Array.isArray(t.tables) && typeof t.templateVersion === 'number'
}

function parseDdl(ddl: string): ColumnDef[] {
  const columns: ColumnDef[] = []
  const bodyMatch = ddl.match(/\(([\s\S]*)\)/i)
  if (!bodyMatch) return columns

  const rawLines = bodyMatch[1]!.split('\n')
  for (const raw of rawLines) {
    const commentIdx = raw.indexOf('--')
    const line = (commentIdx >= 0 ? raw.slice(0, commentIdx) : raw).trim().replace(/,$/, '').trim()
    if (!line) continue
    const nameMatch = line.match(/^"?(\w+)"?\s/i)
    if (!nameMatch) continue
    const name = nameMatch[1]!

    const typeMatch = line.match(/\b(TEXT|INTEGER|INT|REAL|BLOB|VARCHAR[^,\s]*)\b/i)
    const type = typeMatch ? typeMatch[1]!.toUpperCase().replace(/^INT$/i, 'INTEGER') : 'TEXT'

    const upper = line.toUpperCase()
    const constraints: ColumnDef['constraints'] = {}
    if (upper.includes('PRIMARY KEY')) constraints.primaryKey = true
    if (upper.includes('UNIQUE')) constraints.unique = true
    if (upper.includes('NOT NULL')) constraints.nullable = false

    const defMatch = line.match(/DEFAULT\s+('(?:[^']|'')*'|\S+)/i)
    if (defMatch) constraints.defaultValue = defMatch[1]!

    columns.push({ name, displayName: name, type, constraints: Object.keys(constraints).length > 0 ? constraints : undefined })
  }
  return columns
}

export function convertShujukuToCardTemplate(shujuku: ShujukuTemplate): CardTemplate {
  const tables: TableDef[] = []
  const keys = Object.keys(shujuku).filter((k) => k.startsWith('sheet_')).sort((a, b) => {
    const ao = (shujuku[a] as ShujukuSheet)?.orderNo ?? 999
    const bo = (shujuku[b] as ShujukuSheet)?.orderNo ?? 999
    return ao - bo
  })

  for (const key of keys) {
    const sheet = shujuku[key] as ShujukuSheet
    if (!sheet) continue

    const sheetName = String(sheet.name ?? '').trim()
    const sheetUid = String(sheet.uid ?? '').trim()
    const isChronicle =
      sheetName === '纪要表' ||
      sheetName === '总结表' ||
      sheetName === '总体大纲' ||
      sheetUid.toLowerCase().includes('chronicle')

    const src = sheet.sourceData
    let columns: ColumnDef[] = []

    if (src?.ddl) {
      columns = parseDdl(src.ddl)
    }

    if (sheet.content && Array.isArray(sheet.content[0])) {
      const header = sheet.content[0] as (string | null)[]
      for (let i = 0; i < header.length; i++) {
        const hdr = (header[i] ?? '').trim()
        if (!hdr) continue
        if (i < columns.length) {
          if (!columns[i]!.displayName || columns[i]!.displayName === columns[i]!.name) {
            columns[i]!.displayName = hdr
          }
        } else {
          columns.push({ name: `col_${i}`, displayName: hdr, type: 'TEXT' })
        }
      }
    }

    columns = columns.filter((c) => c.name !== 'row_id')

    const sendLatestRows = typeof sheet.updateConfig?.sendLatestRows === 'number'
      ? sheet.updateConfig.sendLatestRows
      : undefined
    tables.push({
      name: sheet.uid?.replace(/^sheet_/, '') ?? key.replace(/^sheet_/, ''),
      displayName: sheet.name ?? key,
      columns,
      note: src?.note ?? '',
      insertHint: src?.insertNode ?? '',
      updateHint: src?.updateNode ?? '',
      deleteHint: src?.deleteNode ?? '',
      updateConfig: sendLatestRows !== undefined ? { sendLatestRows } : undefined,
      enabled: isChronicle ? false : undefined
    })
  }

  return { templateVersion: 1, tables }
}

export function createUserTemplatePreset(tpl: CardTemplate | null): TableTemplatePreset | null {
  if (!tpl) return null
  const template = JSON.parse(JSON.stringify(tpl)) as CardTemplate
  for (const t of template.tables) {
    if (t.name === CHRONICLE_TABLE_NAME && t.enabled !== false) t.enabled = false
  }
  return {
    id: newId('tpl'),
    name: '默认模板副本',
    template,
    source: 'user'
  }
}
