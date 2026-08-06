import type { ChronicleEntry } from '@shared/types/worldbook'

export function buildSearchableText(entry: ChronicleEntry): string {
  const parts = [entry.content.summary, entry.content.location, entry.content.importantWord]
    .filter((s): s is string => Boolean(s && s.trim()))
  return parts.length > 0 ? parts.join('\n') : entry.key
}
