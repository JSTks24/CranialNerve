import type { SqlValue } from 'sql.js'
import type SqliteCore from './core'
import type { ChatGateway } from '@db/gateways/chat'
import type { DatabaseSnapshot, TableSnapshot, TableDef } from '@shared/types/table'
import { DB_FIELD_PREFIX } from '@shared/constants/msg-fields'
import { buildCreateTableSql, quoteIdent } from '@shared/template-builder'

export interface LoadResult {
	ok: boolean
	warnings: string[]
}

interface SyncBridge {
	save(messageId: number): void
	load(): LoadResult
	findLatestSnapshot(): number | null
}

export default class SqliteSyncBridge implements SyncBridge {
	private readonly core: SqliteCore
	private readonly chat: ChatGateway
	public lastLoadWarnings: string[] = []

	constructor(core: SqliteCore, chat: ChatGateway) {
		this.core = core
		this.chat = chat
	}

	save(messageId: number): void {
		const snapshot = this.buildSnapshot()
		this.chat.writeMessageExtra(messageId, DB_FIELD_PREFIX, JSON.stringify(snapshot))
	}

	load(template?: { tables: TableDef[] }): LoadResult {
		this.lastLoadWarnings = []
		const id = this.findLatestSnapshot()
		if (id == null) {
			return { ok: false, warnings: ['未找到任何数据库快照，将从模板初始化空表'] }
		}
		const raw = this.chat.readMessageExtra(id, DB_FIELD_PREFIX)
		if (typeof raw !== 'string' || raw.length === 0) {
			return { ok: false, warnings: [`消息 #${id} 的快照数据为空或格式异常`] }
		}
		let snapshot: DatabaseSnapshot
		try {
			snapshot = JSON.parse(raw) as DatabaseSnapshot
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			return { ok: false, warnings: [`快照 JSON 解析失败: ${msg}`] }
		}
		if (!Array.isArray(snapshot.tables)) {
			return { ok: false, warnings: ['快照结构异常：缺少 tables 数组'] }
		}

		const warnings = this.checkSchemaCompat(snapshot, template)
		this.lastLoadWarnings = warnings

		this.applySnapshot(snapshot)
		return { ok: true, warnings }
	}

	findLatestSnapshot(): number | null {
		const chat = this.chat.getChat()
		for (let i = chat.length - 1; i >= 0; i--) {
			const msg = chat[i]
			const extra = msg?.extra
			if (extra && typeof extra[DB_FIELD_PREFIX] === 'string') {
				return i
			}
		}
		return null
	}

	cleanupOldSnapshots(retainFloors: number): void {
		if (retainFloors <= 0) return
		const chat = this.chat.getChat()
		let kept = 0
		for (let i = chat.length - 1; i >= 0; i--) {
			const msg = chat[i]
			if (!msg || msg.is_user) continue
			const extra = msg.extra
			if (extra && typeof extra[DB_FIELD_PREFIX] === 'string') {
				kept++
				if (kept > retainFloors) {
					delete extra[DB_FIELD_PREFIX]
				}
			}
		}
	}

	checkSchemaCompat(snapshot: DatabaseSnapshot, template?: { tables: TableDef[] }): string[] {
		const warnings: string[] = []
		if (!template?.tables || template.tables.length === 0) return warnings

		const templateMap = new Map<string, TableDef>()
		for (const t of template.tables) {
			templateMap.set(t.name, t)
		}

		for (const snapTable of snapshot.tables) {
			const tmpl = templateMap.get(snapTable.name)
			if (!tmpl) continue

			const snapCols = new Set(snapTable.columns.map((c) => c.name))
			const tmplCols = new Set(tmpl.columns.map((c) => c.name))

			const extraInSnap = [...snapCols].filter((c) => !tmplCols.has(c))
			const missingInSnap = [...tmplCols].filter((c) => !snapCols.has(c))

			const typeChanges: string[] = []
			if (missingInSnap.length === 0 && extraInSnap.length === 0) {
				const snapColMap = new Map(snapTable.columns.map((c) => [c.name, c.type]))
				for (const tc of tmpl.columns) {
					const scType = snapColMap.get(tc.name)
					if (scType && scType.toUpperCase() !== tc.type.toUpperCase()) {
						typeChanges.push(`${tc.name}(${scType}→${tc.type})`)
					}
				}
			}

			if (extraInSnap.length > 0) {
				warnings.push(
					`表「${snapTable.name}」快照比模板多 ${extraInSnap.length} 列：${extraInSnap.join('、')}（将被保留但模板不认）`
				)
			}
			if (missingInSnap.length > 0) {
				warnings.push(
					`表「${snapTable.name}」快照缺少模板中的 ${missingInSnap.length} 列：${missingInSnap.join('、')}（新列数据将丢失）`
				)
			}
			if (typeChanges.length > 0) {
				warnings.push(
					`表「${snapTable.name}」列类型已变更：${typeChanges.join('、')}`
				)
			}
		}
		return warnings
	}

	private buildSnapshot(): DatabaseSnapshot {
		const tables = this.core.listTables().map((name) => {
			const columns = this.core.getTableColumns(name)
			const result = this.core.exec(`SELECT * FROM ${quoteIdent(name)}`)
			const rows = result.length > 0 ? (result[0] as { rows: Record<string, SqlValue>[] }).rows : []
			return { name, columns, rows } satisfies TableSnapshot
		})
		return { tables }
	}

	private applySnapshot(snapshot: DatabaseSnapshot): void {
		for (const table of snapshot.tables) {
			this.core.run(`DROP TABLE IF EXISTS ${quoteIdent(table.name)}`)
			this.core.run(buildCreateTableSql(table))
			for (const row of table.rows) {
				this.core.run(buildInsert(table.name, table.columns, row))
			}
		}
	}
}

function buildInsert(tableName: string, columns: ColumnDefLike[], row: Record<string, SqlValue>): string {
	const cols: string[] = []
	const vals: string[] = []
	for (const col of columns) {
		cols.push(quoteIdent(col.name))
		vals.push(formatValue(row[col.name]))
	}
	return `INSERT INTO ${quoteIdent(tableName)} (${cols.join(', ')}) VALUES (${vals.join(', ')})`
}

type ColumnDefLike = { name: string }

function formatValue(value: SqlValue | undefined): string {
	if (value === null || value === undefined) {
		return 'NULL'
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : 'NULL'
	}
	if (value instanceof Uint8Array) {
		return `X'${Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('')}'`
	}
	return `'${String(value).replace(/'/g, "''")}'`
}
