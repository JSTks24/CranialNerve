import type SqliteCore from './core'
import type { ChatGateway } from '@db/gateways/chat'
import type { DatabaseSnapshot, TableDef } from '@shared/types/table'
import { buildCreateTableSql, quoteIdent } from '@shared/template-builder'
import createFrameRepo, { type FrameRepo } from './storage-frame-repo'
import { replayFrames, splitStatements } from './frame-replay'
import {
	createPersistContext,
	writeCheckpoint,
	compactAtBoundary,
	ensureInitCheckpoint,
	appendSqlLog
} from './frame-persist'
import type { SqlBatchOperation } from '@shared/types/storage-frame'
import { pushLog } from '@shared/log-buffer'

export interface LoadResult {
	ok: boolean
	warnings: string[]
	snapshotIndex: number | null
}

export default class SqliteSyncBridge {
	private readonly core: SqliteCore
	private readonly repo: FrameRepo
	public lastLoadWarnings: string[] = []

	constructor(core: SqliteCore, chat: ChatGateway) {
		this.core = core
		this.repo = createFrameRepo(chat)
	}

	save(messageId: number): void {
		ensureInitCheckpoint(createPersistContext(this.repo, this.core), messageId)
	}

	load(template?: { tables: TableDef[] }): LoadResult {
		this.lastLoadWarnings = []
		const replay = replayFrames(this.repo)
		const warnings = replay.warnings
		this.lastLoadWarnings = warnings

		if (!replay.snapshot) {
			return { ok: false, warnings, snapshotIndex: replay.snapshotIndex }
		}

		const schemaWarnings = this.checkSchemaCompat(replay.snapshot, template)
		this.lastLoadWarnings = [...warnings, ...schemaWarnings]

		try {
			this.applySnapshot(replay.snapshot)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			this.lastLoadWarnings.push(`快照重建失败，已回退保留旧表: ${msg}`)
			return { ok: false, warnings: this.lastLoadWarnings, snapshotIndex: replay.snapshotIndex }
		}

		for (const op of replay.operations) {
			if (op.kind === 'sql_batch') {
				for (let i = 0; i < op.statements.length; i++) {
					const stmt = op.statements[i]
					if (!stmt) continue
					const params = op.params?.[i]
					try {
						if (params) {
							this.core.run(stmt, params)
						} else {
							this.core.run(stmt)
						}
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e)
						pushLog('warn', 'replay', `回放 SQL 失败（已跳过）: ${stmt} -> ${msg}`)
						this.lastLoadWarnings.push(`回放 SQL 失败已跳过: ${msg}`)
					}
				}
			}
		}

		return { ok: true, warnings: this.lastLoadWarnings, snapshotIndex: replay.snapshotIndex }
	}

	listSnapshotIndices(): number[] {
		return this.repo.listFrameMessageIds()
	}

	countSnapshots(): number {
		return this.repo.countFrames()
	}

	loadSnapshotAt(index: number): LoadResult {
		this.lastLoadWarnings = []
		const frame = this.repo.loadFrame(index)
		if (!frame?.checkpoint?.data) {
			return { ok: false, warnings: [`第 ${index + 1} 楼无 V2 checkpoint`], snapshotIndex: index }
		}
		try {
			this.applySnapshot(frame.checkpoint.data)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			return { ok: false, warnings: [`快照重建失败: ${msg}`], snapshotIndex: index }
		}
		for (const entry of frame.logEntries) {
			for (const op of entry.operations) {
				if (op.kind === 'sql_batch') {
					for (let i = 0; i < op.statements.length; i++) {
						const stmt = op.statements[i]
						if (!stmt) continue
						const params = op.params?.[i]
						try {
							if (params) this.core.run(stmt, params)
							else this.core.run(stmt)
						} catch {
						}
					}
				}
			}
		}
		return { ok: true, warnings: [], snapshotIndex: index }
	}

	findLatestSnapshot(): number | null {
		return this.repo.findLatestFrameMessageId()
	}

	removeAllSnapshots(): void {
		this.repo.removeAllFrames()
	}

	cleanupOldSnapshots(retainFloors: number): void {
		if (retainFloors <= 0) return
		compactAtBoundary(createPersistContext(this.repo, this.core), retainFloors)
	}

	writeCheckpoint(messageId: number, reason: 'init' | 'migration' | 'import' | 'compaction' | 'manual'): void {
		writeCheckpoint(createPersistContext(this.repo, this.core), messageId, reason)
	}

	appendManualSqlLog(messageId: number, statements: string[], params?: (string | number | null)[][]): void {
		const ctx = createPersistContext(this.repo, this.core)
		const op: SqlBatchOperation = { kind: 'sql_batch', statements, params, reason: 'manual_edit' }
		appendSqlLog(ctx, messageId, [op])
	}

	getRepo(): FrameRepo {
		return this.repo
	}

	applySnapshotExternal(snapshot: DatabaseSnapshot): void {
		this.applySnapshot(snapshot)
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
						typeChanges.push(`${tc.name}(${scType}->${tc.type})`)
					}
				}
			}

			if (extraInSnap.length > 0) {
				warnings.push(`表「${snapTable.name}」快照比模板多 ${extraInSnap.length} 列：${extraInSnap.join('、')}`)
			}
			if (missingInSnap.length > 0) {
				warnings.push(`表「${snapTable.name}」快照缺少模板中的 ${missingInSnap.length} 列：${missingInSnap.join('、')}`)
			}
			if (typeChanges.length > 0) {
				warnings.push(`表「${snapTable.name}」列类型已变更：${typeChanges.join('、')}`)
			}
		}
		return warnings
	}

	private applySnapshot(snapshot: DatabaseSnapshot): void {
		this.core.transaction((tx) => {
			for (const table of snapshot.tables) {
				tx.run(`DROP TABLE IF EXISTS ${quoteIdent(table.name)}`)
				tx.run(buildCreateTableSql(table))
				const colNames = table.columns.map((c) => c.name)
				const insertSql = buildInsertSql(table.name, colNames)
				for (const row of table.rows) {
					tx.run(insertSql, colNames.map((c) => row[c] ?? null))
				}
			}
		})
	}
}

function buildInsertSql(tableName: string, colNames: string[]): string {
	const cols = colNames.map((c) => quoteIdent(c))
	const placeholders = colNames.map(() => '?').join(', ')
	return `INSERT INTO ${quoteIdent(tableName)} (${cols.join(', ')}) VALUES (${placeholders})`
}

export { splitStatements }
