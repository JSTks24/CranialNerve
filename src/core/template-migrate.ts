import type SqliteCore from '@db/sqlite/core'
import type { CardTemplate } from '@shared/types/card'
import type { DatabaseSnapshot } from '@shared/types/table'
import { quoteIdent } from '@shared/template-builder'
import { pushLog } from '@shared/log-buffer'
import type { SqlValue } from 'sql.js'

export interface MigrationDiff {
  compatible: boolean
  incompatible: Array<{ table: string; cols: string[] }>
  removedTables: string[]
  migratedTables: Array<{ table: string; commonCols: string[]; rowCount: number }>
}

export function analyzeMigration(
  oldTemplate: CardTemplate | null,
  newTemplate: CardTemplate,
  oldSnapshot: DatabaseSnapshot
): MigrationDiff {
  const incompatible: Array<{ table: string; cols: string[] }> = []
  const removedTables: string[] = []
  const migratedTables: Array<{ table: string; commonCols: string[]; rowCount: number }> = []
  if (!oldTemplate) {
    return { compatible: true, incompatible, removedTables, migratedTables }
  }
  const oldDataMap = new Map(oldSnapshot.tables.map((t) => [t.name, t]))
  for (const oldTable of oldTemplate.tables) {
    if (oldTable.enabled === false) continue
    const oldData = oldDataMap.get(oldTable.name)
    if (!oldData || oldData.rows.length === 0) continue
    const newTable = newTemplate.tables.find((t) => t.name === oldTable.name)
    if (!newTable) {
      removedTables.push(oldTable.name)
      continue
    }
    const newColSet = new Set(newTable.columns.map((c) => c.name))
    const commonCols = oldTable.columns.map((c) => c.name).filter((n) => newColSet.has(n))
    const missing = oldTable.columns.filter((c) => !newColSet.has(c.name)).map((c) => c.name)
    if (missing.length > 0) incompatible.push({ table: oldTable.name, cols: missing })
    if (commonCols.length > 0) {
      migratedTables.push({ table: oldTable.name, commonCols, rowCount: oldData.rows.length })
    }
  }
  const compatible = incompatible.length === 0 && removedTables.length === 0
  return { compatible, incompatible, removedTables, migratedTables }
}

export function migrateCommonData(
  core: SqliteCore,
  oldSnapshot: DatabaseSnapshot,
  newTemplate: CardTemplate
): number {
  let migrated = 0
  for (const newTable of newTemplate.tables) {
    if (!newTable.name || newTable.enabled === false) continue
    const oldTable = oldSnapshot.tables.find((t) => t.name === newTable.name)
    if (!oldTable || oldTable.rows.length === 0) continue
    const oldColSet = new Set(oldTable.columns.map((c) => c.name))
    const commonCols = newTable.columns.map((c) => c.name).filter((n) => oldColSet.has(n))
    if (commonCols.length === 0) continue
    const cols = commonCols.map((c) => quoteIdent(c))
    const placeholders = commonCols.map(() => '?').join(', ')
    const insertSql = `INSERT INTO ${quoteIdent(newTable.name)} (${cols.join(', ')}) VALUES (${placeholders})`
    for (const row of oldTable.rows) {
      try {
        const values: SqlValue[] = commonCols.map((c) => {
          const v = (row as Record<string, unknown>)[c]
          if (v == null) return null
          if (typeof v === 'number' || typeof v === 'string') return v
          return String(v)
        })
        core.run(insertSql, values)
        migrated++
      } catch (e) {
        pushLog('warn', 'migrate', `迁移行跳过: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  return migrated
}
