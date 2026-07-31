import type { CranialNerveSession } from './session'
import type { WorldInfoData, WorldInfoEntry } from '@shared/types/worldbook'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import { WORLDBOOK_ORDER_MIN } from '@shared/constants/worldbook'
import { pushLog } from '@shared/log-buffer'

export const WORLD_BOOK_PREFIX = 'CN_Data_' as const

export function buildBookName(chatToken: string): string {
  return WORLD_BOOK_PREFIX + chatToken
}

export function nextUid(entries: Record<number, WorldInfoEntry>): number {
  let max = 0
  for (const uid of Object.keys(entries)) {
    const n = Number.parseInt(uid, 10)
    if (Number.isFinite(n) && n > max) {
      max = n
    }
  }
  return max + 1
}

export async function syncToWorldbook(session: CranialNerveSession): Promise<void> {
  const chatToken = session.getChatToken()
  const bookName = buildBookName(chatToken)
  const wb = session.worldbook
  const existingNames = wb.listWorldbookNames()
  if (!existingNames.includes(bookName)) {
    await wb.createWorldbook(bookName)
  }
  const entries: Record<number, WorldInfoEntry> = {}
  const usedOrders = new Set<number>()
  let orderCounter = WORLDBOOK_ORDER_MIN
  try {
    const existing = await wb.loadLorebook(bookName)
    for (const [uidStr, entry] of Object.entries(existing.entries)) {
      if (entry && entry.comment !== 'CN_auto_generated') {
        const uid = Number.parseInt(uidStr, 10)
        if (Number.isFinite(uid)) {
          entries[uid] = entry
        }
      }
    }
  } catch (e) {
    pushLog('warn', 'worldbook', `加载现有书 ${bookName} 失败（视为无手动条目）: ${e instanceof Error ? e.message : String(e)}`)
  }
  for (const entry of Object.values(entries)) {
    if (Number.isFinite(entry.order)) {
      usedOrders.add(entry.order)
    }
  }
  while (usedOrders.has(orderCounter)) {
    orderCounter++
  }
  const chronicleDef = session.getChronicleTableDef()
  const chronicleKeyCol = chronicleDef.columns.find((c) => c.role === 'key')?.name
  const chronicleSummaryCols = [
    chronicleDef.columns.find((c) => c.role === 'summary')?.name,
    chronicleDef.columns.find((c) => c.role === 'keyDialogue')?.name
  ].filter((v): v is string => typeof v === 'string')
  const tableNames = session.listTables()
  for (const tableName of tableNames) {
    const results = session.getTableRowsWithRowid(tableName)
    if (results.length === 0) {
      continue
    }
    const result = results[0]
    if (!result) {
      continue
    }
    const isChronicle = tableName === CHRONICLE_TABLE_NAME
    if (isChronicle) {
      for (const row of result.rows) {
        const keyCol = findKeyColumn(result.columns, tableName, row, chronicleKeyCol)
        const summaryCol = findSummaryColumn(result.columns, tableName, row, chronicleSummaryCols)
        const uid = nextUid(entries)
        entries[uid] = {
          uid,
          key: [String(keyCol)],
          content: buildChronicleContent(result.columns, row),
          comment: 'CN_auto_generated',
          constant: false,
          selective: true,
          position: 4,
          role: 0,
          depth: 4,
          order: orderCounter++,
          displayIndex: uid,
          disable: false
        }
        entries[uid].keysecondary = [summaryCol].filter((s) => s.length > 0)
      }
    } else {
      const tableDef = session.getTableDef(tableName)
      const exportCfg = tableDef?.exportConfig
      if (exportCfg && !exportCfg.enabled) {
        continue
      }
      if (exportCfg && exportCfg.entryType === 'keyword') {
        const keywordStr = exportCfg.keywords || ''
        const keys = keywordStr.split(/[,，]/).map((k) => k.trim()).filter(Boolean)
        const tableMarkdown = buildTableMarkdown(tableName, result.columns, result.rows)
        if (!tableMarkdown || keys.length === 0) {
          continue
        }
        const uid = nextUid(entries)
        entries[uid] = {
          uid,
          key: keys,
          content: tableMarkdown,
          comment: 'CN_auto_generated',
          constant: false,
          selective: true,
          position: 4,
          role: 0,
          depth: 4,
          order: orderCounter++,
          displayIndex: uid,
          disable: false
        }
      } else {
        const tableMarkdown = buildTableMarkdown(tableName, result.columns, result.rows)
        if (!tableMarkdown) {
          continue
        }
        const uid = nextUid(entries)
        entries[uid] = {
          uid,
          key: [tableName],
          content: tableMarkdown,
          comment: 'CN_auto_generated',
          constant: true,
          selective: false,
          position: 4,
          role: 0,
          depth: 4,
          order: orderCounter++,
          displayIndex: uid,
          disable: false
        }
      }
    }
  }
  const data: WorldInfoData = { entries }
  await wb.saveLorebook(bookName, data)
  await wb.attachToChat(bookName)
}

function findKeyColumn(
  columns: string[],
  tableName: string,
  row: Record<string, unknown>,
  chronicleKeyCol?: string
): string {
  const priorityCols =
    tableName === CHRONICLE_TABLE_NAME
      ? [chronicleKeyCol, 'key'].filter((v): v is string => typeof v === 'string' && v.length > 0)
      : ['key', 'id', 'row_id', columns[0] ?? '']
  for (const col of priorityCols) {
    const v = row[col]
    if (v != null && String(v).trim().length > 0) {
      return String(v)
    }
  }
  return String(row.__rowid__ ?? 'unknown')
}

function findSummaryColumn(
  columns: string[],
  tableName: string,
  row: Record<string, unknown>,
  chronicleSummaryCols?: string[]
): string {
  const summaryCols =
    tableName === CHRONICLE_TABLE_NAME
      ? [...(chronicleSummaryCols ?? []), 'chronicle_text', 'key_dialogue']
      : ['summary', 'desc', 'description', 'note', columns[1] ?? '']
  for (const col of summaryCols) {
    const v = row[col]
    if (v != null && String(v).trim().length > 0) {
      const text = String(v)
      return text.length > 80 ? text.slice(0, 80) + '...' : text
    }
  }
  return ''
}

function buildChronicleContent(
  columns: string[],
  row: Record<string, unknown>
): string {
  const filtered = columns.filter((c) => c !== '__rowid__')
  const obj: Record<string, unknown> = {}
  for (const col of filtered) {
    obj[col] = row[col]
  }
  return JSON.stringify(obj)
}

function buildTableMarkdown(
  tableName: string,
  columns: string[],
  rows: Record<string, unknown>[]
): string {
  const filteredCols = columns.filter((c) => c !== '__rowid__')
  if (filteredCols.length === 0) {
    return ''
  }
  let md = `# ${tableName}\n\n`
  md += `| ${filteredCols.join(' | ')} |\n`
  md += `|${filteredCols.map(() => '---').join('|')}|\n`
  for (const row of rows) {
    const cells = filteredCols.map((c) => String(row[c] ?? ''))
    md += `| ${cells.join(' | ')} |\n`
  }
  return md
}

export async function cleanupStaleBooks(session: CranialNerveSession): Promise<void> {
  const wb = session.worldbook
  const all = wb.listWorldbookNames()
  const currentBook = buildBookName(session.getChatToken())
  for (const name of all) {
    if (name.startsWith(WORLD_BOOK_PREFIX) && name !== currentBook) {
      try {
        await wb.deleteWorldbook(name)
      } catch (e) {
        pushLog('error', 'worldbook', `清理世界书失败: ${name} - ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  try {
    await wb.detachFromChat()
  } catch (e) {
    pushLog('warn', 'worldbook', `detach 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}
