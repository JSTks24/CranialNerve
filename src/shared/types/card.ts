import type { TableDef } from './table'

export interface CardTemplate {
    templateVersion: number
    tables: TableDef[]
}
