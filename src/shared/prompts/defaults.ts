import type { PromptSegment } from '@shared/types/config'

export interface RawSegment {
  name: string
  role: PromptSegment['role']
  content: string
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function buildSegments(raw: RawSegment[]): PromptSegment[] {
  return raw.map((s) => ({
    id: newId('seg'),
    name: s.name,
    role: s.role,
    content: s.content
  }))
}

let tableEditSegments: PromptSegment[] = []
let chronicleRecallSegments: PromptSegment[] = []

export function setDefaultPrompts(tableEdit: RawSegment[], chronicleRecall: RawSegment[]): void {
  tableEditSegments = buildSegments(tableEdit)
  chronicleRecallSegments = buildSegments(chronicleRecall)
}

export function getDefaultTableEditPrompt(): PromptSegment[] {
  return tableEditSegments
}

export function getDefaultChronicleRecallPrompt(): PromptSegment[] {
  return chronicleRecallSegments
}
