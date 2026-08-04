import type { TablePlacement } from '@shared/types/table'

export const CHRONICLE_KEY_PREFIX = 'CN'
export const CHRONICLE_KEY_PAD = 4

export const WORLDBOOK_ORDER_MIN = 10000
export const WORLDBOOK_ORDER_MAX = 99999

export const DEFAULT_ENTRY_PLACEMENT: TablePlacement = {
  position: 'at_depth_as_system',
  depth: 2,
  order: 10000
}

export const CHRONICLE_ENTRY_PLACEMENT: TablePlacement = {
  position: 'at_depth_as_system',
  depth: 9999,
  order: 99987
}
