import type { RecallCardItem, RecallCardPayload } from './types/recall-card'

export interface RecallItemLike {
  key: string
  timeDeltaText: string
  entry: {
    timeStart?: string
    timeEnd?: string
    content: {
      location?: string
      summary?: string
      keyDialogue?: string
    }
  }
}

export function serializeRecallPayload(items: RecallItemLike[]): string {
  const payload: RecallCardPayload = {
    v: 1,
    items: items.map((it) => ({
      key: it.key,
      timeDeltaText: it.timeDeltaText,
      timeStart: it.entry.timeStart ?? '',
      timeEnd: it.entry.timeEnd ?? '',
      location: it.entry.content.location ?? '',
      summary: it.entry.content.summary ?? '',
      keyDialogue: it.entry.content.keyDialogue ?? '',
    })),
  }
  return JSON.stringify(payload)
}

export function parseRecallPayload(raw: unknown): RecallCardPayload | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null
  }
  try {
    const obj = JSON.parse(raw) as unknown
    if (typeof obj !== 'object' || obj === null) {
      return null
    }
    const items: unknown = (obj as { items?: unknown }).items
    if (!Array.isArray(items) || items.length === 0) {
      return null
    }
    const normalized: RecallCardItem[] = []
    for (const it of items) {
      if (typeof it !== 'object' || it === null) {
        return null
      }
      const item = it as Record<string, unknown>
      if (typeof item.key !== 'string' || item.key.length === 0) {
        return null
      }
      normalized.push({
        key: item.key,
        timeDeltaText: typeof item.timeDeltaText === 'string' ? item.timeDeltaText : '',
        timeStart: typeof item.timeStart === 'string' ? item.timeStart : '',
        timeEnd: typeof item.timeEnd === 'string' ? item.timeEnd : '',
        location: typeof item.location === 'string' ? item.location : '',
        summary: typeof item.summary === 'string' ? item.summary : '',
        keyDialogue: typeof item.keyDialogue === 'string' ? item.keyDialogue : '',
      })
    }
    return { v: 1, items: normalized }
  } catch {
    return null
  }
}

const KEY_LINE_RE = /^(?:CN\d{4}[ \t]*)+(?:\r?\n|$)/

export function stripKeyLineFromMes(mes: string): string {
  return mes.replace(KEY_LINE_RE, '')
}
