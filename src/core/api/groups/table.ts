import type { ApiGroupContext } from './types'
import type { QueryResult, TableDef } from '@shared/types/table'

export function createTableApi(ctx: ApiGroupContext): Record<string, Function> {
	return {
		listTables(): string[] {
			return ctx.getSession().listTables()
		},
		getTableDef(name: string): TableDef | null {
			return ctx.getSession().getTableDef(name)
		},
		getTableData(name: string): QueryResult[] {
			return ctx.getSession().getTableData(name)
		},
		getTableRowsWithRowid(name: string): QueryResult[] {
			return ctx.getSession().getTableRowsWithRowid(name)
		},
		updateCell(tableName: string, rowid: number, column: string, value: string): void {
			ctx.getSession().updateCell(tableName, rowid, column, value)
		},
		insertRow(tableName: string, values: Record<string, string>): void {
			ctx.getSession().insertRow(tableName, values)
		},
		deleteRow(tableName: string, rowid: number): void {
			ctx.getSession().deleteRow(tableName, rowid)
		},
		toEnglish(name: string): string {
			const mapper = ctx.getSession().getNameMapper()
			if (!mapper) {
				throw new Error('NameMapper not initialized')
			}
			return mapper.toEnglish(name)
		},
		toChinese(name: string): string {
			const mapper = ctx.getSession().getNameMapper()
			if (!mapper) {
				throw new Error('NameMapper not initialized')
			}
			return mapper.toChinese(name)
		},
		isChinese(name: string): boolean {
			const mapper = ctx.getSession().getNameMapper()
			if (!mapper) {
				return false
			}
			return mapper.isChinese(name)
		}
	}
}
