import type { TableDef } from '@shared/types/table'

type ColumnMaps = {
    cnToEn: Map<string, string>
    enToCn: Map<string, string>
}

export default class NameMapper {
    private readonly tableCnToEn = new Map<string, string>()
    private readonly tableEnToCn = new Map<string, string>()
    private readonly columnsByTable = new Map<string, ColumnMaps>()

    constructor(tables: TableDef[]) {
        for (const table of tables) {
            this.tableCnToEn.set(table.displayName, table.name)
            this.tableEnToCn.set(table.name, table.displayName)

            const cnToEn = new Map<string, string>()
            const enToCn = new Map<string, string>()
            for (const col of table.columns) {
                cnToEn.set(col.displayName, col.name)
                enToCn.set(col.name, col.displayName)
            }
            this.columnsByTable.set(table.name, { cnToEn, enToCn })
        }
    }

    toEnglish(name: string): string
    toEnglish(table: string, col: string): string
    toEnglish(table: string, col?: string): string {
        if (col === undefined) {
            return this.toEnglishName(this.tableCnToEn, this.tableEnToCn, table)
        }
        const resolvedTable = this.toEnglishName(this.tableCnToEn, this.tableEnToCn, table)
        const maps = this.columnsByTable.get(resolvedTable)
        if (!maps) {
            throw new Error(`name "${col}" not found in table "${table}"`)
        }
        return this.toEnglishName(maps.cnToEn, maps.enToCn, col)
    }

    toChinese(name: string): string
    toChinese(table: string, col: string): string
    toChinese(table: string, col?: string): string {
        if (col === undefined) {
            return this.toChineseName(this.tableCnToEn, this.tableEnToCn, table)
        }
        const resolvedTable = this.toEnglishName(this.tableCnToEn, this.tableEnToCn, table)
        const maps = this.columnsByTable.get(resolvedTable)
        if (!maps) {
            throw new Error(`name "${col}" not found in table "${table}"`)
        }
        return this.toChineseName(maps.cnToEn, maps.enToCn, col)
    }

    isChinese(name: string): boolean
    isChinese(table: string, col: string): boolean
    isChinese(table: string, col?: string): boolean {
        if (col === undefined) {
            return this.tableCnToEn.has(table)
        }
        const resolvedTable = this.toEnglishName(this.tableCnToEn, this.tableEnToCn, table)
        const maps = this.columnsByTable.get(resolvedTable)
        if (!maps) {
            return false
        }
        return maps.cnToEn.has(col)
    }

    private toEnglishName(cnToEn: Map<string, string>, enToCn: Map<string, string>, name: string): string {
        if (cnToEn.has(name)) {
            return cnToEn.get(name) as string
        }
        if (enToCn.has(name)) {
            return name
        }
        throw new Error(`name "${name}" not found`)
    }

    private toChineseName(cnToEn: Map<string, string>, enToCn: Map<string, string>, name: string): string {
        if (enToCn.has(name)) {
            return enToCn.get(name) as string
        }
        if (cnToEn.has(name)) {
            return name
        }
        throw new Error(`name "${name}" not found`)
    }
}
