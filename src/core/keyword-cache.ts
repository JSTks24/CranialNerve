import type { CranialNerveSession } from './session'
import type { RowKeywordsEntry, TableKeywordsCache } from '@shared/types/keyword-cache'
import type { TableDef } from '@shared/types/table'
import { KEYWORDS_FIELD_PREFIX } from '@shared/constants/msg-fields'
import { fnv1aHash } from '@shared/fingerprint'
import createFrameRepo from '@db/sqlite/storage-frame-repo'

export function keywordsFieldName(tableName: string): string {
  return KEYWORDS_FIELD_PREFIX + tableName
}

export function computeTableFingerprint(def: TableDef | null | undefined, columns: string[]): string {
  const exportCfg = def?.exportConfig
  const promptText = (exportCfg?.keywordAiPrompt ?? [])
    .map((s) => `${s.role}:${s.content}`)
    .join('\n')
  return fnv1aHash(
    JSON.stringify({
      columns,
      keywordMode: exportCfg?.keywordMode ?? '',
      keywordColumn: exportCfg?.keywordColumn ?? '',
      promptText
    })
  )
}

export function computeRowFingerprint(row: Record<string, unknown>): string {
  const parts: string[] = []
  for (const key of Object.keys(row)) {
    if (key === '__rowid__') {
      continue
    }
    parts.push(`${key}=${String(row[key] ?? '')}`)
  }
  parts.sort()
  return fnv1aHash(parts.join('|'))
}

export function computeRowIdentity(def: TableDef | null | undefined, row: Record<string, unknown>): string | undefined {
  const columns = def?.columns ?? []
  const pk = columns.find((c) => c.constraints?.primaryKey)
  if (pk) {
    const v = row[pk.name]
    if (v != null && String(v).trim().length > 0) {
      return String(v)
    }
  }
  const first = columns[0]
  if (first) {
    const v = row[first.name]
    if (v != null && String(v).trim().length > 0) {
      return String(v)
    }
  }
  return undefined
}

export function entryMatches(
  cache: TableKeywordsCache,
  def: TableDef | null | undefined,
  row: Record<string, unknown>
): boolean {
  const entry = cache.rows[String(row.__rowid__)]
  if (!entry) {
    return false
  }
  const id = computeRowIdentity(def, row)
  if (id != null && id.length > 0 && entry.id != null && entry.id.length > 0) {
    return entry.id === id
  }
  return entry.f === computeRowFingerprint(row)
}

export function entryKeywords(cache: TableKeywordsCache, row: Record<string, unknown>): string[] {
  const entry = cache.rows[String(row.__rowid__)]
  return entry ? entry.k : []
}

export function readKeywordsCache(session: CranialNerveSession, tableName: string): TableKeywordsCache | null {
  const chat = session.chat.getChat()
  const field = keywordsFieldName(tableName)
  for (let i = chat.length - 1; i >= 0; i--) {
    const extra = chat[i]?.extra
    if (!extra) {
      continue
    }
    const raw = extra[field]
    if (typeof raw !== 'string' || raw.length === 0) {
      continue
    }
    try {
      const cache = JSON.parse(raw) as TableKeywordsCache
      if (!cache || cache.v !== 1 || typeof cache.tf !== 'string' || !cache.rows || typeof cache.rows !== 'object') {
        return null
      }
      return cache
    } catch {
      return null
    }
  }
  return null
}

export function writeKeywordsCache(
  session: CranialNerveSession,
  tableName: string,
  rows: Record<string, unknown>[],
  rowKeysList: string[][],
  tableFp: string
): void {
  const rowsMap: Record<string, RowKeywordsEntry> = {}
  const def = session.getTableDef(tableName)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) {
      continue
    }
    const rowid = row.__rowid__
    if (rowid == null) {
      continue
    }
    rowsMap[String(rowid)] = {
      k: rowKeysList[i] ?? [],
      f: computeRowFingerprint(row),
      id: computeRowIdentity(def, row)
    }
  }
  const cache: TableKeywordsCache = { v: 1, tf: tableFp, rows: rowsMap }
  const chat = session.chat.getChat()
  const frameId = createFrameRepo(session.chat).findLatestFrameMessageId()
  const targetId = frameId ?? chat.length - 1
  if (targetId < 0 || targetId >= chat.length) {
    return
  }
  session.chat.writeMessageExtra(targetId, keywordsFieldName(tableName), JSON.stringify(cache))
}
