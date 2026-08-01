const CN_REGEX_PREFIX = 'CranialNerve - '
const LEGACY_REGEX_PREFIX = 'CN - '
const CN_REGEX_PREFIXES = [CN_REGEX_PREFIX, LEGACY_REGEX_PREFIX]

const PROMPT_CLEAN_SCRIPT = {
	scriptName: 'CranialNerve - 召回防污染',
	findRegex: '/\\[CN_recall_ui\\][\\s\\S]*?\\[\\/CN_recall_ui\\]\\n?/',
	replaceString: '',
	trimStrings: [] as string[],
	placement: [1],
	disabled: false,
	markdownOnly: false,
	promptOnly: true,
	runOnEdit: false,
	substituteRegex: 0,
	minDepth: null as number | null,
	maxDepth: null as number | null
}

const DISPLAY_SCRIPT = {
	scriptName: 'CranialNerve - 静候佳音',
	findRegex: '/\\[CN_recall_ui\\]([\\s\\S]*?)\\[\\/CN_recall_ui\\][\\s\\S]*/',
	replaceString: '$1',
	trimStrings: [] as string[],
	placement: [1],
	disabled: false,
	markdownOnly: true,
	promptOnly: false,
	runOnEdit: true,
	substituteRegex: 0,
	minDepth: null as number | null,
	maxDepth: 1
}

const FADED_HINT = '<div style="display:flex;align-items:center;gap:10px;margin:2px 0 10px;color:#a9bcae;user-select:none"><span style="flex:1;height:1px;background:linear-gradient(to right,transparent,#d4e3d9)"></span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b9d2c0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1.53.848"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg><span style="font-size:12px;font-style:italic;letter-spacing:3px;text-indent:3px;">楼层久远，记忆随风而去</span><span style="flex:1;height:1px;background:linear-gradient(to left,transparent,#d4e3d9)"></span></div>'

const DISPLAY_FADE_SCRIPT = {
	scriptName: 'CranialNerve - 健忘症',
	findRegex: '/^(?:CN\\d{4}[ \\t]*)+(?:\\r?\\n|$)/',
	replaceString: FADED_HINT,
	trimStrings: [] as string[],
	placement: [1],
	disabled: false,
	markdownOnly: true,
	promptOnly: false,
	runOnEdit: true,
	substituteRegex: 0,
	minDepth: 2,
	maxDepth: null as number | null
}

const PROMPT_KEYS_CLEAN_SCRIPT = {
	scriptName: 'CranialNerve - 旧忆尘封',
	findRegex: '/^(?:CN\\d{4}[ \\t]*)+(?:\\r?\\n|$)/',
	replaceString: '',
	trimStrings: [] as string[],
	placement: [1],
	disabled: false,
	markdownOnly: false,
	promptOnly: true,
	runOnEdit: false,
	substituteRegex: 0,
	minDepth: 2,
	maxDepth: null as number | null
}

function generateId(): string {
	return 'cn_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36)
}

export function registerCNRegexScripts(regexArr: Record<string, unknown>[]): Record<string, unknown>[] {
	const scripts: Record<string, unknown>[] = Array.isArray(regexArr) ? regexArr : []

	const filtered = scripts.filter((s) => {
		const name = s.scriptName
		return typeof name === 'string' && !CN_REGEX_PREFIXES.some((p) => name.startsWith(p))
	})

	const prompt = { ...PROMPT_CLEAN_SCRIPT, id: generateId() }
	const display = { ...DISPLAY_SCRIPT, id: generateId() }
	const displayFade = { ...DISPLAY_FADE_SCRIPT, id: generateId() }
	const keysClean = { ...PROMPT_KEYS_CLEAN_SCRIPT, id: generateId() }

	return [...filtered, prompt, display, displayFade, keysClean]
}

export function unregisterCNRegexScripts(regexArr: Record<string, unknown>[]): Record<string, unknown>[] {
	if (!Array.isArray(regexArr)) {
		return []
	}
	return regexArr.filter((s) => {
		const name = s.scriptName
		return typeof name === 'string' && !CN_REGEX_PREFIXES.some((p) => name.startsWith(p))
	})
}
