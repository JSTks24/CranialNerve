import type SqliteCore from '@db/sqlite/core'
import type { PersistContext } from '@db/sqlite/frame-persist'
import { appendSqlLog } from '@db/sqlite/frame-persist'
import { splitStatements } from '@db/sqlite/frame-replay'
import type { TableEditSqlV1 } from '@shared/types/ai'

export interface SqlExecResult {
    ok: boolean
    error?: string
    changes?: number
}

export interface SqlExecPersist {
    ctx: PersistContext
    messageId: number
}

export default function executeTableEditSql(
    core: SqliteCore,
    edit: TableEditSqlV1,
    persist?: SqlExecPersist
): SqlExecResult {
    try {
        const changes = core.transaction((tx) => {
            const before = tx.getRowsModified()
            tx.run(edit.sql)
            return tx.getRowsModified() - before
        })
        if (persist) {
            const statements = splitStatements(edit.sql)
            appendSqlLog(persist.ctx, persist.messageId, [{
                kind: 'sql_batch',
                statements,
                reason: 'ai_fill'
            }])
        }
        return { ok: true, changes }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
}
