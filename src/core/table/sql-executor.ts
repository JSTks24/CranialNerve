import type SqliteCore from '@db/sqlite/core'
import type { TableEditSqlV1 } from '@shared/types/ai'

export interface SqlExecResult {
    ok: boolean
    error?: string
    changes?: number
}

export default function executeTableEditSql(core: SqliteCore, edit: TableEditSqlV1): SqlExecResult {
    try {
        const changes = core.transaction((tx) => {
            const before = tx.getRowsModified()
            tx.run(edit.sql)
            return tx.getRowsModified() - before
        })
        return { ok: true, changes }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
}
