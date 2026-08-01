import type { SqlValue } from 'sql.js'

export interface ColumnConstraints {
    primaryKey?: boolean
    unique?: boolean
    nullable?: boolean
    defaultValue?: string
}

export type ChronicleColumnRole =
    | 'key'
    | 'timeStart'
    | 'timeEnd'
    | 'location'
    | 'summary'
    | 'keyDialogue'

export interface ColumnDef {
    name: string
    displayName: string
    type: string
    constraints?: ColumnConstraints
    note?: string
    role?: ChronicleColumnRole
}

export interface TableDef {
    name: string
    displayName: string
    columns: ColumnDef[]
    note?: string
    insertHint?: string
    updateHint?: string
    deleteHint?: string
    exportConfig?: TableExportConfig
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

export interface TableExportConfig {
    enabled: boolean
    entryType: 'constant' | 'keyword'
    splitByRow: boolean
    keywordColumn: string
    keywords: string
    keywordMode?: 'custom' | 'ai_prompt'
    keywordAiPrompt?: string
}
