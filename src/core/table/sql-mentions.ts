export function sqlMentionsTable(sql: string, tableName: string): boolean {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|REPLACE\\s+INTO)\\s+["'\`]?${escaped}(?![A-Za-z0-9_])`, 'i').test(sql)
}
