export interface RowKeywordsEntry {
  k: string[]
  f: string
  id?: string
}

export interface TableKeywordsCache {
  v: 1
  tf: string
  rows: Record<string, RowKeywordsEntry>
}
