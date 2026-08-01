const CN_REGEX_PREFIXES = ['CranialNerve - ', 'CN - ']

export function removeCNRegexScripts(regexArr: Record<string, unknown>[]): Record<string, unknown>[] {
	if (!Array.isArray(regexArr)) {
		return []
	}
	return regexArr.filter((s) => {
		const name = s.scriptName
		return typeof name === 'string' && !CN_REGEX_PREFIXES.some((p) => name.startsWith(p))
	})
}
