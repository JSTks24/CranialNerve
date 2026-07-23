import type { CranialNerveSession } from './session'
import type { WorldInfoData, WorldInfoEntry } from '@shared/types/worldbook'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'

export const WORLD_BOOK_PREFIX = 'CN_Data_' as const

export function buildBookName(chatToken: string): string {
  return WORLD_BOOK_PREFIX + chatToken
}

function genId(): number {
  return Math.floor(Math.random() * 1000000) + 1
}

export async function syncToWorldbook(session: CranialNerveSession): Promise<void> {
  const chatToken = session.getChatToken()
  const bookName = buildBookName(chatToken)
  const wb = session.worldbook
  const existingNames = wb.listWorldbookNames()
  if (!existingNames.includes(bookName)) {
    await wb.createWorldbook(bookName)
  }
  const tableNames = session.listTables()
  const entries: Record<number, WorldInfoEntry> = {}
  for (const tableName of tableNames) {
    const results = session.getTableRowsWithRowid(tableName)
    if (results.length === 0) {
      continue
    }
    const result = results[0]
    if (!result) {
      continue
    }
    for (const row of result.rows) {
      const keyCol = findKeyColumn(result.columns, tableName, row)
      const summaryCol = findSummaryColumn(result.columns, tableName, row)
      const uid = genId()
      entries[uid] = {
        uid,
        key: [String(keyCol)],
        content: buildRowContent(result.columns, row, tableName),
        comment: 'CN_auto_generated',
        constant: false,
        selective: true,
        position: 4,
        role: 0,
        depth: 4,
        order: 100,
        displayIndex: uid,
        disable: false
      }
      entries[uid].keysecondary = [summaryCol].filter((s) => s.length > 0)
    }
  }
  const data: WorldInfoData = { entries }
  await wb.saveLorebook(bookName, data)
  await wb.attachToChat(bookName)
}

function findKeyColumn(columns: string[], tableName: string, row: Record<string, unknown>): string {
  const priorityCols =
    tableName === CHRONICLE_TABLE_NAME ? ['key'] : ['key', 'id', 'row_id', columns[0] ?? '']
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
  row: Record<string, unknown>
): string {
  const summaryCols =
    tableName === CHRONICLE_TABLE_NAME
      ? ['chronicle_text', 'key_dialogue']
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

function buildRowContent(
  columns: string[],
  row: Record<string, unknown>,
  tableName: string
): string {
  const lines = columns.filter((c) => c !== '__rowid__').map((c) => `${c}: ${String(row[c] ?? '')}`)
  return `[${tableName}]\n${lines.join('\n')}`
}

export async function cleanupStaleBooks(session: CranialNerveSession): Promise<void> {
  const wb = session.worldbook
  const all = wb.listWorldbookNames()
  const currentBook = buildBookName(session.getChatToken())
  for (const name of all) {
    if (name.startsWith(WORLD_BOOK_PREFIX) && name !== currentBook) {
      try {
        await wb.deleteWorldbook(name)
      } catch {
        // Book may already be deleted or inaccessible
      }
    }
  }
}

export async function onChatChanged(
  session: CranialNerveSession,
  _newChatToken: string
): Promise<void> {
  await cleanupStaleBooks(session)
  await syncToWorldbook(session)
}
