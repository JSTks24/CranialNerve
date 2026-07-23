/**
 * shujuku TABLE_TEMPLATE_ACU ↔ CranialNerve CardTemplate 双向转换
 *
 * shujuku 格式（Sheet_ACU）:
 *   { mate: {...}, sheet_xxx: { uid, name, sourceData: { note, initNode, deleteNode, updateNode, insertNode, ddl }, content: [[header],[row]...], updateConfig, exportConfig, orderNo } }
 *
 * CranialNerve 格式（CardTemplate）:
 *   { templateVersion: 1, tables: [{ name, displayName, columns: [{ name, displayName, type, constraints, note }], note, insertHint, updateHint, deleteHint }] }
 */

import type { CardTemplate } from '@shared/types/card'
import type { TableDef, ColumnDef } from '@shared/types/table'

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

/** 检测 JSON 是否为 shujuku 格式 */
export function isShujukuTemplate(obj: unknown): obj is ShujukuTemplate {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const keys = Object.keys(obj as Record<string, unknown>)
  const sheetKeys = keys.filter((k) => k.startsWith('sheet_'))
  if (sheetKeys.length === 0) return false
  const first = (obj as Record<string, unknown>)[sheetKeys[0]!]
  if (!first || typeof first !== 'object') return false
  return typeof (first as Record<string, unknown>).sourceData === 'object'
}

/** 检测 JSON 是否为 CranialNerve 格式 */
export function isCardTemplate(obj: unknown): obj is CardTemplate {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const t = obj as Record<string, unknown>
  return Array.isArray(t.tables) && typeof t.templateVersion === 'number'
}

/** 解析 shujuku DDL 为列定义 */
function parseDdl(ddl: string): ColumnDef[] {
  const columns: ColumnDef[] = []
  const bodyMatch = ddl.match(/\(([\s\S]*)\)/i)
  if (!bodyMatch) return columns

  const lines = bodyMatch[1]!.split(',').map((l) => l.trim()).filter((l) => l.length > 0)
  for (const line of lines) {
    const nameMatch = line.match(/^"?(\w+)"?\s/i)
    if (!nameMatch) continue
    const name = nameMatch[1]!

    // 提取类型
    const typeMatch = line.match(/\b(TEXT|INTEGER|INT|REAL|BLOB|VARCHAR[^,\s]*)\b/i)
    const type = typeMatch ? typeMatch[1]!.toUpperCase().replace(/^INT$/i, 'INTEGER') : 'TEXT'

    // 提取中文注释
    const commentMatch = line.match(/--\s*(.+)/)
    const displayName = commentMatch ? commentMatch[1]!.trim() : name

    // 提取约束
    const upper = line.toUpperCase()
    const constraints: ColumnDef['constraints'] = {}
    if (upper.includes('PRIMARY KEY')) constraints.primaryKey = true
    if (upper.includes('UNIQUE')) constraints.unique = true
    if (upper.includes('NOT NULL')) constraints.nullable = false

    const defMatch = line.match(/DEFAULT\s+(\S+)/i)
    if (defMatch) constraints.defaultValue = defMatch[1]!.replace(/^['"]|['"]$/g, '')

    columns.push({ name, displayName, type, constraints: Object.keys(constraints).length > 0 ? constraints : undefined })
  }
  return columns
}

/** shujuku 模板 → CardTemplate */
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

    const src = sheet.sourceData
    let columns: ColumnDef[] = []

    if (src?.ddl) {
      columns = parseDdl(src.ddl)
    }

    // DDL 解析不够时从 content[0]（表头行）补中文名
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

    tables.push({
      name: sheet.uid?.replace(/^sheet_/, '') ?? key.replace(/^sheet_/, ''),
      displayName: sheet.name ?? key,
      columns,
      note: src?.note ?? '',
      insertHint: src?.insertNode ?? '',
      updateHint: src?.updateNode ?? '',
      deleteHint: src?.deleteNode ?? ''
    })
  }

  return { templateVersion: 1, tables }
}

/** CardTemplate → shujuku 格式（用于导出兼容） */
export function convertCardTemplateToShujuku(template: CardTemplate): ShujukuTemplate {
  const result: ShujukuTemplate = {
    mate: { type: 'chatSheets', version: 2, updateConfigUiSentinel: -1 }
  }

  template.tables.forEach((table, idx) => {
    const colLines: string[] = ['  row_id INTEGER PRIMARY KEY']
    const colNames: string[] = ['row_id']

    table.columns.forEach((col) => {
      const constraints = col.constraints
      let line = `  ${col.name} ${col.type}`
      if (constraints?.nullable === false) line += ' NOT NULL'
      if (constraints?.unique) line += ' UNIQUE'
      if (constraints?.defaultValue !== undefined) line += ` DEFAULT ${constraints.defaultValue}`
      line += `, -- ${col.displayName || col.name}`
      colLines.push(line)
      colNames.push(col.displayName || col.name)
    })

    const ddl = `CREATE TABLE ${table.name} (\n${colLines.join('\n')}\n);`

    result[`sheet_${idx}`] = {
      uid: `sheet_${table.name}`,
      name: table.displayName || table.name,
      sourceData: {
        note: table.note ?? '',
        initNode: '',
        deleteNode: table.deleteHint ?? '',
        updateNode: table.updateHint ?? '',
        insertNode: table.insertHint ?? '',
        ddl
      },
      content: [colNames],
      updateConfig: {
        uiSentinel: -1,
        contextDepth: -1,
        updateFrequency: -1,
        batchSize: -1,
        skipFloors: -1
      },
      exportConfig: {
        enabled: false,
        splitByRow: false,
        entryName: table.displayName || table.name,
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexEntryName: '',
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
        fixedEntryPlacement: { position: 'at_depth_as_system', depth: 2, order: 99990 },
        fixedIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 99991 },
        injectIntoWorldbook: false
      },
      orderNo: idx + 1
    }
  })

  return result
}
