import type SqliteCore from '@db/sqlite/core'
import type { PersistContext } from '@db/sqlite/frame-persist'
import { appendSqlLog, writeCheckpoint } from '@db/sqlite/frame-persist'
import { splitStatements } from '@db/sqlite/frame-replay'
import type { TableEditSqlV1 } from '@shared/types/ai'
import { pushLog } from '@shared/log-buffer'
import { formatChronicleKey } from './chronicle-keymap'

const ALLOWED_SQL_START = /^\s*(INSERT\b|UPDATE\b|DELETE\b|REPLACE\b)/i

function isAllowedSql(sql: string): boolean {
  return ALLOWED_SQL_START.test(sql)
}

/**
 * 按顶层逗号切分 VALUES 值列表（引号/转义/括号感知，可跨行）。
 * 值内部单引号转义（'' 与 \'）与括号均不参与切分。
 */
function hasMultiRowValues(valuesStr: string): boolean {
	let inSingle = false
	let escape = false
	for (let i = 0; i < valuesStr.length; i++) {
		const ch = valuesStr[i]
		if (inSingle) {
			if (escape) {
				escape = false
			} else if (ch === '\\') {
				escape = true
			} else if (ch === "'") {
				inSingle = false
			}
			continue
		}
		if (ch === "'") {
			inSingle = true
			continue
		}
		if (ch === ')') {
			let j = i + 1
			while (j < valuesStr.length && /\s/.test(valuesStr[j]!)) j++
			if (valuesStr[j] === ',') {
				let k = j + 1
				while (k < valuesStr.length && /\s/.test(valuesStr[k]!)) k++
				if (valuesStr[k] === '(') return true
			}
		}
	}
	return false
}

function splitValues(valuesStr: string): string[] {
	const out: string[] = []
	let current = ''
	let depth = 0
	let inSingle = false
	let escape = false
	for (let i = 0; i < valuesStr.length; i++) {
		const ch = valuesStr[i]
		if (inSingle) {
			current += ch
			if (escape) {
				escape = false
			} else if (ch === '\\') {
				escape = true
			} else if (ch === "'") {
				inSingle = false
			}
			continue
		}
		if (ch === "'") {
			inSingle = true
			current += ch
			continue
		}
		if (ch === '(') {
			depth++
			current += ch
			continue
		}
		if (ch === ')') {
			depth--
			current += ch
			continue
		}
		if (ch === ',' && depth === 0) {
			out.push(current.trim())
			current = ''
			continue
		}
		current += ch
	}
	out.push(current.trim())
	return out
}

/**
 * 把 AI 生成的纪要 INSERT 改写为「楼层绑定 key + REPLACE INTO」：
 * 解析列名与 VALUES，把 key 列的值强制替换为 formatChronicleKey(targetSeq)，
 * 语句转为 REPLACE INTO（覆盖同 key 旧行）。重填同楼层即覆盖、绝不堆积。
 *
 * 只处理 cn_chronicle 表的 INSERT/REPLACE；其余语句原样保留。
 * 无法可靠解析（缺列名/key 列/值数不匹配等）返回 null，调用方走删旧行兜底。
 */
export function rewriteChronicleInsert(sql: string, targetSeq: number): string | null {
	const targetKey = formatChronicleKey(targetSeq)
	const statements = splitStatements(sql)
	let changed = false
	const out = statements.map((stmt) => {
		const m = /^\s*(?:INSERT|REPLACE)\s+(?:OR\s+REPLACE\s+)?INTO\s+["`]?cn_chronicle["`]?\s*\(([^)]*)\)\s*VALUES\s*\((.*)\)\s*;?\s*$/is.exec(stmt)
		if (!m) return stmt
		if (hasMultiRowValues(m[2]!)) return stmt
		const cols = m[1]!
			.split(',')
			.map((c) => c.trim().replace(/^["`\[]+|["`\]]+$/g, ''))
			.map((c) => c.toLowerCase())
		const keyIdx = cols.indexOf('key')
		if (keyIdx < 0) return stmt
		const vals = splitValues(m[2]!)
		if (keyIdx >= vals.length) return stmt
		vals[keyIdx] = `'${targetKey}'`
		changed = true
		return `REPLACE INTO cn_chronicle (${m[1]}) VALUES (${vals.join(', ')})`
	})
	if (!changed) return null
	return out.join('; ')
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
