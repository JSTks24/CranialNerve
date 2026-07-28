import type { PromptBlock, PromptSegment } from '@shared/types/config'
import tableEditJson from '../../../prompts/tableEdit.json'
import chronicleRecallJson from '../../../prompts/chronicleRecall.json'

interface RawSegment {
  role: PromptSegment['role']
  content: string
}

interface RawBlock {
  name: string
  segments: RawSegment[]
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function buildBlocks(raw: RawBlock[]): PromptBlock[] {
  return raw.map((b) => ({
    id: newId('blk'),
    name: b.name,
    segments: b.segments.map((s) => ({
      id: newId('seg'),
      role: s.role,
      content: s.content
    }))
  }))
}

export const DEFAULT_TABLE_EDIT_PROMPT: PromptBlock[] = buildBlocks(tableEditJson as RawBlock[])
export const DEFAULT_CHRONICLE_RECALL_PROMPT: PromptBlock[] = buildBlocks(
  chronicleRecallJson as RawBlock[]
)
