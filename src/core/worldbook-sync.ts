import type { CranialNerveSession } from './session'
import type { WorldInfoData, WorldInfoEntry } from '@shared/types/worldbook'
import type { TablePlacementPosition } from '@shared/types/table'
import { CHRONICLE_TABLE_NAME, CHRONICLE_COLUMNS } from '@shared/constants/chronicle'
import { DEFAULT_ENTRY_PLACEMENT, CHRONICLE_ENTRY_PLACEMENT } from '@shared/constants/worldbook'
import { pushLog } from '@shared/log-buffer'
import {
  computeTableFingerprint,
  entryKeywords,
  entryMatches,
  readKeywordsCache,
  writeKeywordsCache
} from './keyword-cache'

function positionToRole(position: TablePlacementPosition): number {
  if (position === 'at_depth_as_user') return 1
  if (position === 'at_depth_as_assistant') return 2
  return 0
}

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
  const chronicleKeyCol = CHRONICLE_COLUMNS.key
  const chronicleSummaryCols = [CHRONICLE_COLUMNS.summary, CHRONICLE_COLUMNS.importantWord]
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
      const placement = CHRONICLE_ENTRY_PLACEMENT
      for (let i = 0; i < result.rows.length; i++) {
        const row = result.rows[i]!
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
          position: placement.position,
          role: positionToRole(placement.position),
          depth: placement.depth,
          order: placement.order + i,
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
      const placement = exportCfg?.entryPlacement ?? DEFAULT_ENTRY_PLACEMENT
      if (exportCfg && exportCfg.entryType === 'keyword') {
        const rows = result.rows
        let rowKeysList: string[][]
        if (exportCfg.keywordMode === 'ai_prompt') {
          const cache = readKeywordsCache(session, tableName)
          const tableFp = computeTableFingerprint(tableDef, result.columns)
          const validCache = cache !== null && cache.tf === tableFp ? cache : null
          const hasMissing = validCache === null || rows.some((row) => !entryMatches(validCache, tableDef, row))
          if (hasMissing) {
            try {
              rowKeysList = await session.generateKeywordsForRows(tableName)
              writeKeywordsCache(session, tableName, rows, rowKeysList, tableFp)
            } catch (e) {
              pushLog('warn', 'worldbook', `AI 生成行关键词失败 ${tableName}: ${e instanceof Error ? e.message : String(e)}`)
              rowKeysList = rows.map((row) =>
                validCache !== null && entryMatches(validCache, tableDef, row) ? entryKeywords(validCache, row) : []
              )
            }
          } else {
            rowKeysList = rows.map((row) => entryKeywords(validCache!, row))
          }
        } else {
          const keywordCol = exportCfg.keywordColumn
          rowKeysList = rows.map((row) => {
            const val = keywordCol ? String(row[keywordCol] ?? '').trim() : ''
            return val ? val.split(/[,，]/).map((k) => k.trim()).filter(Boolean) : []
          })
        }
        for (let i = 0; i < rows.length; i++) {
          const keys = rowKeysList[i] ?? []
          if (keys.length === 0) {
            continue
          }
          const rowMarkdown = buildRowMarkdown(tableName, result.columns, rows[i]!)
          if (!rowMarkdown) {
            continue
          }
          const uid = nextUid(entries)
          entries[uid] = {
            uid,
            key: keys,
            content: rowMarkdown,
            comment: 'CN_auto_generated',
            constant: false,
            selective: true,
            position: placement.position,
            role: positionToRole(placement.position),
            depth: placement.depth,
            order: placement.order + i,
            displayIndex: uid,
            disable: false
          }
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
          position: placement.position,
          role: positionToRole(placement.position),
          depth: placement.depth,
          order: placement.order,
          displayIndex: uid,
          disable: false
        }
      }
    }
  }
  const data: WorldInfoData = { entries }
  await wb.saveLorebook(bookName, data)
  if (!wb.isAttachedToChat(bookName)) {
    await wb.attachToChat(bookName)
  }
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
      ? [...(chronicleSummaryCols ?? []), 'chronicle_text', 'important_word']
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

function buildRowMarkdown(
  tableName: string,
  columns: string[],
  row: Record<string, unknown>
): string {
  const filteredCols = columns.filter((c) => c !== '__rowid__')
  if (filteredCols.length === 0) {
    return ''
  }
  let md = `# ${tableName}\n\n`
  md += `| ${filteredCols.join(' | ')} |\n`
  md += `|${filteredCols.map(() => '---').join('|')}|\n`
  const cells = filteredCols.map((c) => String(row[c] ?? ''))
  md += `| ${cells.join(' | ')} |\n`
  return md
}

export async function cleanupStaleBooks(session: CranialNerveSession): Promise<void> {
  const wb = session.worldbook
  const all = wb.listWorldbookNames()
  const currentBook = buildBookName(session.getChatToken())
  for (const name of all) {
    if (name.startsWith(WORLD_BOOK_PREFIX) && name !== currentBook) {
      try {
        const data = await wb.loadLorebook(name)
        const hasManual = Object.values(data.entries).some((e) => e && e.comment !== 'CN_auto_generated')
        if (hasManual) {
          pushLog('warn', 'worldbook', `保留含手动条目的书 ${name}，避免删除用户编辑`)
          continue
        }
      } catch (e) {
        pushLog('warn', 'worldbook', `检查世界书 ${name} 手动条目失败，跳过清理: ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      try {
        await wb.deleteWorldbook(name)
      } catch (e) {
        pushLog('warn', 'worldbook', `清理世界书失败: ${name} - ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  try {
    await wb.detachFromChat()
  } catch (e) {
    pushLog('warn', 'worldbook', `detach 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function deleteAllCnBooks(session: CranialNerveSession): Promise<void> {
  const wb = session.worldbook
  const all = wb.listWorldbookNames()
  for (const name of all) {
    if (name.startsWith(WORLD_BOOK_PREFIX)) {
      try {
        await wb.deleteWorldbook(name)
      } catch (e) {
        pushLog('warn', 'worldbook', `删除世界书失败: ${name} - ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  try {
    await wb.detachFromChat()
  } catch (e) {
    pushLog('warn', 'worldbook', `detach 失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}
