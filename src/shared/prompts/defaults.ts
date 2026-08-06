import type { PromptSceneKey, PromptSegment, ScenePreset } from '@shared/types/config'

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
let chronicleGenSegments: PromptSegment[] = []
let chronicleRecallSegments: PromptSegment[] = []

export function setDefaultPrompts(
  tableEdit: RawSegment[],
  chronicleGen: RawSegment[],
  chronicleRecall: RawSegment[]
): void {
  tableEditSegments = buildSegments(tableEdit)
  chronicleGenSegments = buildSegments(chronicleGen)
  chronicleRecallSegments = buildSegments(chronicleRecall)
}

export function getDefaultTableEditPrompt(): PromptSegment[] {
  return tableEditSegments
}

export function getDefaultChronicleGenPrompt(): PromptSegment[] {
  return chronicleGenSegments
}

export function getDefaultChronicleRecallPrompt(): PromptSegment[] {
  return chronicleRecallSegments
}

export function createDefaultPreset(scene: PromptSceneKey): ScenePreset {
  const src =
    scene === 'chronicleRecall'
      ? getDefaultChronicleRecallPrompt()
      : scene === 'chronicleGen'
        ? getDefaultChronicleGenPrompt()
        : getDefaultTableEditPrompt()
  return {
    id: newId('preset'),
    name: '默认提示词副本',
    segments: src.map((s) => ({
      id: newId('seg'),
      name: s.name,
      role: s.role,
      content: s.content
    }))
  }
}
