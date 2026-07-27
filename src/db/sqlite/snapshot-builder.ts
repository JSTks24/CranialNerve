import type SqliteCore from './core'
import type { DatabaseSnapshot, TableSnapshot } from '@shared/types/table'
import type { SqlValue } from 'sql.js'
import { quoteIdent } from '@shared/template-builder'

export function buildSnapshotFromCore(core: SqliteCore): DatabaseSnapshot {
	const tables: TableSnapshot[] = core.listTables().map((name) => {
		const columns = core.getTableColumns(name)
		const result = core.exec(`SELECT * FROM ${quoteIdent(name)}`)
		const rows = result.length > 0 ? (result[0] as { rows: Record<string, SqlValue>[] }).rows : []
		return { name, columns, rows }
	})
	return { tables }
}
