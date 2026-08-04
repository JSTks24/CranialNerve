import type SqliteCore from '@db/sqlite/core'
import type { PersistContext } from '@db/sqlite/frame-persist'
import { appendSqlLog } from '@db/sqlite/frame-persist'
import type { TableEditSqlV1 } from '@shared/types/ai'
import { pushLog } from '@shared/log-buffer'

export interface SqlExecResult {
    ok: boolean
    error?: string
    changes?: number
    errorCategory?: 'model' | 'infrastructure'
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
            try {
                appendSqlLog(persist.ctx, persist.messageId, [{
                    kind: 'sql_batch',
                    statements: [edit.sql],
                    reason: 'ai_fill'
                }])
            } catch (e) {
                pushLog('error', 'sql-executor', `记录 SQL log 失败（数据已执行）: ${e instanceof Error ? e.message : String(e)}`)
            }
        }
        return { ok: true, changes }
    } catch (e) {
        return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            errorCategory: 'model'
        }
    }
}
