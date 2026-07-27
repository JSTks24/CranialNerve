import type { DatabaseSnapshot } from './table'
import type { CardTemplate } from './card'

export const CHECKPOINT_FORMAT = 'cn-table-checkpoint'
export const CHECKPOINT_VERSION = 1

export interface TableCheckpointFileV1 {
  format: typeof CHECKPOINT_FORMAT
  version: typeof CHECKPOINT_VERSION
  createdAt: number
  tableSnapshot: DatabaseSnapshot
  templateSnapshot: CardTemplate
  integrity: { algorithm: 'fnv1a'; payloadHash: string }
}
