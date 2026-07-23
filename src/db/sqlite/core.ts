import initSqlJs from 'sql.js/dist/sql-wasm.js'
import type { BindParams, Database, QueryExecResult, SqlJsStatic, SqlValue } from 'sql.js'
import type { ColumnDef, QueryResult } from '@shared/types/table'

const sqlWasmUrl = new URL('assets/sql-wasm.wasm', import.meta.url).href

export default class SqliteCore {
    private sqlJs: SqlJsStatic | null = null
    private db: Database | null = null

    get isReady(): boolean {
        return this.db !== null
    }

    async init(): Promise<void> {
        this.dispose()
        if (!this.sqlJs) {
            this.sqlJs = await initSqlJs({ locateFile: () => sqlWasmUrl })
        }
        this.db = new this.sqlJs.Database()
    }

    dispose(): void {
        if (this.db) {
            this.db.close()
            this.db = null
        }
    }

    exec(sql: string, params?: BindParams): QueryResult[] {
        const db = this.requireDb()
        return db.exec(sql, params ?? null).map((r) => this.convertResult(r))
    }

    run(sql: string, params?: BindParams): void {
        const db = this.requireDb()
        db.run(sql, params ?? null)
    }

    export(): Uint8Array {
        return this.requireDb().export()
    }

    load(data: Uint8Array): void {
        if (!this.sqlJs) {
            throw new Error('SqliteCore not initialized')
        }
        this.dispose()
        this.db = new this.sqlJs.Database(data)
    }

    getRowsModified(): number {
        return this.requireDb().getRowsModified()
    }

    listTables(): string[] {
        const db = this.requireDb()
        const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        if (result.length === 0) {
            return []
        }
        const first = result[0]
        if (!first) {
            return []
        }
        return first.values.map((row) => row[0] as string)
    }

    getTableColumns(tableName: string): ColumnDef[] {
        const db = this.requireDb()
        const result = db.exec(`PRAGMA table_info(${escapeIdentifier(tableName)})`)
        if (result.length === 0) {
            return []
        }
        const first = result[0]
        if (!first) {
            return []
        }
        const columns: ColumnDef[] = []
        for (const row of first.values) {
            const name = row[1] as string
            const type = (row[2] as string) ?? ''
            const notnull = row[3] as number
            const pk = row[5] as number
            columns.push({
                name,
                displayName: name,
                type,
                constraints: {
                    primaryKey: pk > 0 || undefined,
                    nullable: notnull === 0 || undefined,
                },
            })
        }
        return columns
    }

    transaction<T>(fn: (tx: SqliteCore) => T): T {
        this.run('BEGIN TRANSACTION')
        try {
            const result = fn(this)
            this.run('COMMIT')
            return result
        } catch (e) {
            this.run('ROLLBACK')
            throw e
        }
    }

    private requireDb(): Database {
        if (!this.db) {
            throw new Error('SqliteCore not initialized')
        }
        return this.db
    }

    private convertResult(r: QueryExecResult): QueryResult {
        const rows: Record<string, SqlValue>[] = []
        for (const valueRow of r.values) {
            const row: Record<string, SqlValue> = {}
            for (let i = 0; i < r.columns.length; i++) {
                row[r.columns[i] as string] = valueRow[i] as SqlValue
            }
            rows.push(row)
        }
        return { columns: r.columns, rows }
    }
}

function escapeIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`
}
