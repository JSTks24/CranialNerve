import type SqliteCore from '@db/sqlite/core'
import type { PersistContext } from '@db/sqlite/frame-persist'
import { appendSqlLog, writeCheckpoint } from '@db/sqlite/frame-persist'
import { splitStatements } from '@db/sqlite/frame-replay'
import type { TableEditSqlV1 } from '@shared/types/ai'
import { pushLog } from '@shared/log-buffer'

const ALLOWED_SQL_START = /^\s*(INSERT\b|UPDATE\b|DELETE\b|REPLACE\b)/i

function isAllowedSql(sql: string): boolean {
  return ALLOWED_SQL_START.test(sql)
}

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
    edits: TableEditSqlV1[],
    persist?: SqlExecPersist
): SqlExecResult {
    try {
        for (const edit of edits) {
            const sql = edit.sql.trim()
            if (sql.length === 0) continue
            for (const stmt of splitStatements(sql)) {
                if (!isAllowedSql(stmt)) {
                    return {
                        ok: false,
                        error: `包含不允许的语句类型，已拒绝执行：${stmt.slice(0, 60)}`,
                        errorCategory: 'model'
                    }
                }
            }
        }
        const changes = core.transaction((tx) => {
            const before = tx.getRowsModified()
            for (const edit of edits) {
                const sql = edit.sql.trim()
                if (sql.length === 0) continue
                tx.run(sql)
            }
            return tx.getRowsModified() - before
        })
        if (persist) {
            try {
                appendSqlLog(persist.ctx, persist.messageId, [{
                    kind: 'sql_batch',
                    statements: edits.map((e) => e.sql).filter((s) => s.trim().length > 0),
                    reason: 'ai_fill'
                }])
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                pushLog('error', 'sql-executor', `记录 SQL log 失败（数据已执行）: ${msg}`)
                try {
                    writeCheckpoint(persist.ctx, persist.messageId, 'manual')
                    pushLog('warn', 'sql-executor', '落帧失败已补写 checkpoint 兜底，数据已持久化')
                } catch (e2) {
                    pushLog('error', 'sql-executor', `补写 checkpoint 失败: ${e2 instanceof Error ? e2.message : String(e2)}`)
                    return {
                        ok: false,
                        error: 'SQL 已执行但落帧失败，数据可能未持久化，请导出快照备份',
                        errorCategory: 'infrastructure'
                    }
                }
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
