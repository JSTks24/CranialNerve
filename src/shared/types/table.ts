import type { SqlValue } from 'sql.js'
import type { PromptSegment } from './config'

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

export interface TableUpdateConfig {
    sendLatestRows?: number
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
    updateConfig?: TableUpdateConfig
    enabled?: boolean
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

export type TablePlacementPosition =
    | 'at_depth_as_system'
    | 'at_depth_as_user'
    | 'at_depth_as_assistant'
    | 'before_character_definition'
    | 'after_character_definition'

export interface TablePlacement {
    position: TablePlacementPosition
    depth: number
    order: number
}

export interface TableExportConfig {
    enabled: boolean
    entryType: 'constant' | 'keyword'
    keywordColumn: string
    keywordMode?: 'custom' | 'ai_prompt'
    keywordAiPrompt?: PromptSegment[]
    entryPlacement?: TablePlacement
}
