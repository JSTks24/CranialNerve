import type { ScanEntry, ScanOptions } from '@shared/types/worldbook-scanner'
import { WORLD_INFO_LOGIC } from '@shared/types/worldbook-scanner'
import { matchKeys } from './key-matcher'

const MAX_RECURSION_PASSES = 10

export function scanEntries(
	entries: ScanEntry[],
	scanText: string,
	options: ScanOptions = {}
): ScanEntry[] {
	const trigger = options.trigger ?? 'normal'
	const characterName = options.characterName ?? ''
	const characterTagMap = options.characterTagMap ?? {}
	const maxPasses = options.maxRecursionPasses ?? MAX_RECURSION_PASSES

	const filtered = entries.filter((entry) => filterEntry(entry, trigger, characterName, characterTagMap))
	if (filtered.length === 0) {
		return []
	}

	const constantEntries = filtered.filter((e) => e.constant && !isDelayUntilRecursion(e, false))
	const keywordEntries = filtered.filter((e) => !e.constant)

	const activated = new Map<string, ScanEntry>()
	for (const entry of constantEntries) {
		activated.set(entryKey(entry), entry)
	}

	let baseScanText = scanText.toLowerCase()
	const recursionSourceTexts: string[] = []
	let remaining = [...keywordEntries]
	let anyRecursionSource = false

	for (let pass = 0; pass < maxPasses; pass++) {
		const hasRecursion = pass > 0
		const fullScanText = buildFullScanText(baseScanText, recursionSourceTexts)
		const newlyActivated: ScanEntry[] = []
		const stillRemaining: ScanEntry[] = []

		for (const entry of remaining) {
			if (entry.disable) {
				continue
			}

			if (isDecoratorActivate(entry)) {
				newlyActivated.push(entry)
				continue
			}

			if (isDecoratorDontActivate(entry)) {
				continue
			}

			if (isDelayUntilRecursion(entry, hasRecursion)) {
				stillRemaining.push(entry)
				continue
			}

			if (hasRecursion && entry.excludeRecursion) {
				stillRemaining.push(entry)
				continue
			}

			if (!entry.key || entry.key.length === 0) {
				continue
			}

			const textToScan = entry.excludeRecursion ? baseScanText : fullScanText
			const primaryMatch = entry.key.find((key) => {
				const trimmed = key.trim()
				return trimmed.length > 0 && matchKeys(textToScan, trimmed, entry)
			})

			if (!primaryMatch) {
				stillRemaining.push(entry)
				continue
			}

			if (!hasSecondaryKeywords(entry)) {
				newlyActivated.push(entry)
				continue
			}

			const matched = matchSecondaryKeys(entry, textToScan)
			if (matched) {
				newlyActivated.push(entry)
			} else {
				stillRemaining.push(entry)
			}
		}

		if (newlyActivated.length === 0) {
			break
		}

		for (const entry of newlyActivated) {
			activated.set(entryKey(entry), entry)
			if (!entry.preventRecursion) {
				recursionSourceTexts.push(entry.content.toLowerCase())
				anyRecursionSource = true
			}
		}

		remaining = stillRemaining
		if (!anyRecursionSource) {
			break
		}
	}

	const result = Array.from(activated.values())
	result.sort((a, b) => b.order - a.order)
	return result
}

function filterEntry(
	entry: ScanEntry,
	trigger: string,
	characterName: string,
	characterTagMap: Record<string, string[]>
): boolean {
	if (entry.disable) {
		return false
	}

	if (Array.isArray(entry.triggers) && entry.triggers.length > 0) {
		if (!entry.triggers.includes(trigger)) {
			return false
		}
	}

	if (entry.characterFilter) {
		const cf = entry.characterFilter
		if (cf.names && cf.names.length > 0) {
			const nameIncluded = cf.names.includes(characterName)
			if (cf.isExclude ? nameIncluded : !nameIncluded) {
				return false
			}
		}
		if (cf.tags && cf.tags.length > 0 && characterName) {
			const charTags = characterTagMap[characterName] ?? []
			const includesTag = cf.tags.some((t) => charTags.includes(t))
			if (cf.isExclude ? includesTag : !includesTag) {
				return false
			}
		}
	}

	return true
}

function buildFullScanText(baseText: string, recursionTexts: string[]): string {
	if (recursionTexts.length === 0) {
		return baseText
	}
	return baseText + '\n' + recursionTexts.join('\n')
}

function hasSecondaryKeywords(entry: ScanEntry): boolean {
	return (
		entry.selective &&
		Array.isArray(entry.keysecondary) &&
		entry.keysecondary.length > 0
	)
}

function matchSecondaryKeys(entry: ScanEntry, textToScan: string): boolean {
	const logic = entry.selectiveLogic ?? WORLD_INFO_LOGIC.AND_ANY
	let hasAnyMatch = false
	let hasAllMatch = true

	for (const keysecondary of entry.keysecondary) {
		const trimmed = keysecondary.trim()
		if (trimmed.length === 0) {
			continue
		}
		const hasMatch = matchKeys(textToScan, trimmed, entry)
		if (hasMatch) {
			hasAnyMatch = true
		}
		if (!hasMatch) {
			hasAllMatch = false
		}

		if (logic === WORLD_INFO_LOGIC.AND_ANY && hasMatch) {
			return true
		}
		if (logic === WORLD_INFO_LOGIC.NOT_ALL && !hasMatch) {
			return true
		}
	}

	if (logic === WORLD_INFO_LOGIC.NOT_ANY && !hasAnyMatch) {
		return true
	}
	if (logic === WORLD_INFO_LOGIC.AND_ALL && hasAllMatch) {
		return true
	}

	return false
}

function isDecoratorActivate(entry: ScanEntry): boolean {
	return entry.decorators?.includes('@@activate') ?? false
}

function isDecoratorDontActivate(entry: ScanEntry): boolean {
	return entry.decorators?.includes('@@dont_activate') ?? false
}

function isDelayUntilRecursion(entry: ScanEntry, isRecursionPass: boolean): boolean {
	if (!entry.delayUntilRecursion) {
		return false
	}
	if (isRecursionPass) {
		return false
	}
	return true
}

function entryKey(entry: ScanEntry): string {
	return `${entry.world}.${entry.uid}`
}
