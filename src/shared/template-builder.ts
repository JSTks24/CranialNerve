import type { ColumnDef } from './types/table'

interface TableLike {
    name: string
    columns: ColumnDef[]
}

export function buildCreateTableSql(table: TableLike): string {
    if (table.columns.length === 0) {
        throw new Error(`表「${table.name}」没有列，无法生成建表语句`)
    }
    const colDefs = table.columns.map((col) => {
        const parts = [quoteIdent(col.name), col.type || 'TEXT']
        if (col.constraints?.primaryKey) {
            parts.push('PRIMARY KEY')
        }
        if (col.constraints?.unique) {
            parts.push('UNIQUE')
        }
        if (col.constraints?.nullable === false) {
            parts.push('NOT NULL')
        }
        if (col.constraints?.defaultValue != null && col.constraints.defaultValue !== '') {
            parts.push(`DEFAULT ${quoteDefaultValue(col.constraints.defaultValue)}`)
        }
        return parts.join(' ')
    })
    return `CREATE TABLE IF NOT EXISTS ${quoteIdent(table.name)} (${colDefs.join(', ')})`
}

export function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`
}

export function quoteDefaultValue(raw: string): string {
    const trimmed = raw.trim()
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed
    if (/^(NULL|TRUE|FALSE|CURRENT_TIME|CURRENT_DATE|CURRENT_TIMESTAMP)$/i.test(trimmed)) return trimmed
    if (/^\(.*\)$/.test(trimmed)) return trimmed
    if (/^'.*'$/i.test(trimmed)) return trimmed
    return `'${trimmed.replace(/'/g, "''")}'`
}
