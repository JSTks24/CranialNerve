import type { SqlValue } from 'sql.js'

export interface ColumnConstraints {
    primaryKey?: boolean
    unique?: boolean
    nullable?: boolean
    defaultValue?: string
}

export interface ColumnDef {
    name: string
    displayName: string
    type: string
    constraints?: ColumnConstraints
    note?: string
}

export interface TableDef {
    name: string
    displayName: string
    columns: ColumnDef[]
    note?: string
    insertHint?: string
    updateHint?: string
    deleteHint?: string
}

export interface QueryResult {
    columns: string[]
    rows: Record<string, SqlValue>[]
}

export interface TableSnapshot {
    name: string
    columns: ColumnDef[]
    rows: Record<string, SqlValue>[]
}

export interface DatabaseSnapshot {
    tables: TableSnapshot[]
}
