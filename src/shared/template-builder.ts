import type { ColumnDef } from './types/table'

interface TableLike {
    name: string
    columns: ColumnDef[]
}

export function buildCreateTableSql(table: TableLike): string {
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
        if (col.constraints?.defaultValue != null) {
            parts.push(`DEFAULT ${col.constraints.defaultValue}`)
        }
        return parts.join(' ')
    })
    return `CREATE TABLE IF NOT EXISTS ${quoteIdent(table.name)} (${colDefs.join(', ')})`
}

export function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`
}
