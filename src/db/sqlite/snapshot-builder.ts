import type SqliteCore from './core'
import type { DatabaseSnapshot, TableSnapshot } from '@shared/types/table'
import type { SqlValue } from 'sql.js'
import { quoteIdent } from '@shared/template-builder'

export function buildSnapshotFromCore(core: SqliteCore): DatabaseSnapshot {
	const tables: TableSnapshot[] = core.listTables().map((name) => {
		const columns = core.getTableColumns(name)
		const result = core.exec(`SELECT * FROM ${quoteIdent(name)}`)
		const rawRows = result.length > 0 ? (result[0] as { rows: Record<string, SqlValue>[] }).rows : []
		const rows = rawRows.map((r) => {
			const out: Record<string, SqlValue> = {}
			for (const [k, v] of Object.entries(r)) {
				out[k] = v instanceof Uint8Array ? bytesToBase64(v) : v
			}
			return out
		})
		return { name, columns, rows }
	})
	return { tables }
}

function bytesToBase64(bytes: Uint8Array): string {
	let bin = ''
	for (let i = 0; i < bytes.length; i++) {
		bin += String.fromCharCode(bytes[i]!)
	}
	return btoa(bin)
}
