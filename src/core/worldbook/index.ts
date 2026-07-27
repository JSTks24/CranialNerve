import type { ScanEntry, ScanOptions } from '@shared/types/worldbook-scanner'
import type { WorldInfoEntry } from '@shared/types/worldbook'
import { scanEntries as runScan } from './entry-scanner'

export { matchKeys, parseRegexFromString, escapeRegex } from './key-matcher'

export function scanWorldbookEntries(
	entries: WorldInfoEntry[],
	bookName: string,
	scanText: string,
	options?: ScanOptions
): WorldInfoEntry[] {
	const scanEntries: ScanEntry[] = entries.map((e) => toScanEntry(e, bookName))
	const activated = runScan(scanEntries, scanText, options)
	return activated.map((se) => {
		for (const orig of entries) {
			if (orig.uid === se.uid) {
				return orig
			}
		}
		return undefined as unknown as WorldInfoEntry
	}).filter(Boolean)
}

function toScanEntry(entry: WorldInfoEntry, bookName: string): ScanEntry {
	return {
		uid: entry.uid,
		key: entry.key ?? [],
		keysecondary: entry.keysecondary ?? [],
		content: entry.content ?? '',
		comment: entry.comment ?? '',
		constant: entry.constant ?? false,
		selective: entry.selective ?? true,
		disable: entry.disable ?? false,
		position: entry.position ?? 0,
		depth: entry.depth ?? 4,
		order: entry.order ?? 100,
		world: bookName,
		caseSensitive: (entry as Record<string, unknown>).caseSensitive as boolean ?? false,
		matchWholeWords: (entry as Record<string, unknown>).matchWholeWords as boolean ?? false,
		selectiveLogic: (entry as Record<string, unknown>).selectiveLogic as number ?? 0,
		preventRecursion: (entry as Record<string, unknown>).prevent_recursion as boolean ?? false,
		excludeRecursion: (entry as Record<string, unknown>).exclude_recursion as boolean ?? false,
		delayUntilRecursion: (entry as Record<string, unknown>).delay_until_recursion as (number | boolean) ?? false,
		scanDepth: (entry as Record<string, unknown>).scan_depth as number ?? null,
		decorators: (entry as Record<string, unknown>).decorators as string[] ?? [],
		triggers: (entry as Record<string, unknown>).triggers as string[] ?? [],
		characterFilter: (entry as Record<string, unknown>).characterFilter as ScanEntry['characterFilter'] ?? null,
		enabled: (entry as Record<string, unknown>).enabled as boolean ?? true,
	}
}
