import type { ChronicleColumnRole, TableDef } from './types/table'

export const CHRONICLE_ROLE_LABELS: Record<ChronicleColumnRole, string> = {
  key: '编码',
  timeStart: '起始时间',
  timeEnd: '结束时间',
  location: '地点',
  summary: '纪要正文',
  keyDialogue: '重要台词'
}

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
  const roleCounts = new Map<ChronicleColumnRole, number>()
  for (const col of def.columns) {
    if (col.role) {
      roleCounts.set(col.role, (roleCounts.get(col.role) ?? 0) + 1)
    }
  }
  const requiredRoles: ChronicleColumnRole[] = [
    'key',
    'timeStart',
    'timeEnd',
    'location',
    'summary',
    'keyDialogue'
  ]
  const missing = requiredRoles.filter((r) => !roleCounts.has(r))
  const duplicated = [...roleCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([r]) => CHRONICLE_ROLE_LABELS[r])
  if (missing.length === 0 && duplicated.length === 0) {
    return null
  }
  const parts: string[] = []
  if (missing.length > 0) {
    parts.push(`缺少角色: ${missing.map((r) => CHRONICLE_ROLE_LABELS[r]).join('、')}`)
  }
  if (duplicated.length > 0) {
    parts.push(`角色重复: ${duplicated.join('、')}`)
  }
  return parts.join('；') + '。6 个语义角色必须各有且仅有一列持有。'
}
