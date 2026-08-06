import type { TableDef } from './types/table'
import { CHRONICLE_COLUMNS } from './constants/chronicle'

const REQUIRED_CHRONICLE_COLUMNS = Object.values(CHRONICLE_COLUMNS)

export function validateTableDef(table: TableDef, allTables: TableDef[]): string | null {
  if (!table.name.trim()) return '英文表名不能为空'
  if (!table.displayName.trim()) return '中文表名不能为空'
  if (table.columns.length === 0) return '至少需要一列'
  const nameSet = new Set<string>()
  for (const col of table.columns) {
    if (!col.name.trim()) return `表「${table.displayName || table.name}」有列英文名为空`
    if (!col.displayName.trim()) return `表「${table.displayName || table.name}」有列中文名为空`
    if (nameSet.has(col.name.trim()))
      return `表「${table.displayName || table.name}」列英文名重复：${col.name.trim()}`
    nameSet.add(col.name.trim())
  }
  if (table.exportConfig?.entryType === 'keyword') {
    if ((table.exportConfig.keywordMode ?? 'custom') === 'custom') {
      if (!table.exportConfig.keywordColumn?.trim()) {
        return `表「${table.displayName || table.name}」关键词注入模式下，关键词列不能为空`
      }
    }
  }
  const dup = allTables.filter((t) => t !== table && t.name.trim() === table.name.trim())
  if (dup.length > 0) return `表英文名重复：${table.name.trim()}`
  return null
}

export function validateChronicleDef(def: TableDef): string | null {
  const nameSet = new Set<string>()
  for (const col of def.columns) {
    if (!col.name.trim()) return '列英文名不能为空'
    if (!col.displayName.trim()) return '列中文名不能为空'
    if (!col.note?.trim()) return `列「${col.displayName || col.name}」的列说明不能为空`
    if (nameSet.has(col.name.trim())) return `列英文名重复：${col.name.trim()}`
    nameSet.add(col.name.trim())
  }
  const colNames = new Set(def.columns.map((c) => c.name.trim()))
  const missing = REQUIRED_CHRONICLE_COLUMNS.filter((n) => !colNames.has(n))
  if (missing.length > 0) {
    return `纪要表缺少固定列：${missing.join('、')}。纪要表 6 列固定，不可改名或删除。`
  }
  return null
}
