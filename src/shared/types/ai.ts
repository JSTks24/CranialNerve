import { SQL_EDIT_FORMAT } from '@shared/constants/sql-json'

export interface TableEditSqlV1 {
    format: typeof SQL_EDIT_FORMAT
    sql: string
}
