import type { DatabaseSnapshot } from './table'

export type StorageFrameVersion = 2

export type CheckpointReason = 'init' | 'migration' | 'import' | 'compaction' | 'manual' | 'periodic'

export interface FullCheckpoint {
  kind: 'full'
  createdAt: number
  reason: CheckpointReason
  data: DatabaseSnapshot
}

export interface SqlBatchOperation {
  kind: 'sql_batch'
  statements: string[]
  params?: (string | number | null)[][]
  reason?: 'ai_fill' | 'ai_fill_table' | 'ai_fill_chronicle' | 'manual_edit' | 'import' | 'manual_refill'
}

export type MutationOperation = SqlBatchOperation

export interface LogEntry {
  seq: number
  createdAt: number
  operations: MutationOperation[]
}

export interface StorageFrame {
  version: StorageFrameVersion
  headRevision?: string | null
  checkpoint?: FullCheckpoint
  logEntries: LogEntry[]
  summarizedReasons?: SqlBatchOperation['reason'][]
  templateId?: string
}
