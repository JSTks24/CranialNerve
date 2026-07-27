import type { ScanEntry } from '@shared/types/worldbook-scanner'

export function matchKeys(haystack: string, needle: string, entry: ScanEntry): boolean {
	const keyRegex = parseRegexFromString(needle)
	if (keyRegex) {
		return keyRegex.test(haystack)
	}
	haystack = transformString(haystack, entry.caseSensitive)
	const transformedNeedle = transformString(needle, entry.caseSensitive)
	const matchWholeWords = entry.matchWholeWords
	if (matchWholeWords) {
		const keyWords = transformedNeedle.split(/\s+/)
		if (keyWords.length > 1) {
			return haystack.includes(transformedNeedle)
		}
		const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedNeedle)})(?:$|\\W)`)
		return regex.test(haystack)
	}
	return haystack.includes(transformedNeedle)
}

export function parseRegexFromString(input: string): RegExp | null {
	const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/)
	if (!match) {
		return null
	}
	const [, pattern, flags] = match
	if (!pattern) {
		return null
	}
	if (pattern.match(/(^|[^\\])\//)) {
		return null
	}
	const unescaped = pattern.replace('\\/', '/')
	try {
		return new RegExp(unescaped, flags)
	} catch {
		return null
	}
}

export function escapeRegex(str: string): string {
	return str.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')
}

function transformString(str: string, caseSensitive: boolean): string {
	return caseSensitive ? str : str.toLowerCase()
}
