const CN_REGEX_PREFIX = 'CN - '

const PROMPT_SCRIPT = {
	scriptName: 'CN - 召回 AI 清理',
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

const DEEP_CLEANUP_AI_SCRIPT = {
	scriptName: 'CN - 召回深层清理（AI）',
	findRegex: '/^(?:CN\\d{4}\\s*)+\\n/',
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

const DISPLAY_SCRIPT = {
	scriptName: 'CN - 召回卡片渲染',
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
	maxDepth: null as number | null
}

const DEEP_CLEANUP_DISPLAY_SCRIPT = {
	scriptName: 'CN - 召回深层清理（显示）',
	findRegex: '/<div class="cn-recall-tabs">[\\s\\S]*?<\\/div>\\s*(?=<div class="cn-recall-card__message">)/',
	replaceString: '<div class="cn-recall-faded"><i class="fa-solid fa-feather cn-recall-faded__icon"></i><span class="cn-recall-faded__text">楼层久远，记忆随风而去...</span></div>',
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

function generateId(): string {
	return 'cn_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36)
}

export function registerCNRegexScripts(regexArr: Record<string, unknown>[]): Record<string, unknown>[] {
	const scripts: Record<string, unknown>[] = Array.isArray(regexArr) ? regexArr : []

	const filtered = scripts.filter(
		(s) => typeof s.scriptName === 'string' && !s.scriptName.startsWith(CN_REGEX_PREFIX)
	)

	const prompt = { ...PROMPT_SCRIPT, id: generateId() }
	const deepCleanupAi = { ...DEEP_CLEANUP_AI_SCRIPT, id: generateId() }
	const display = { ...DISPLAY_SCRIPT, id: generateId() }
	const deepCleanupDisplay = { ...DEEP_CLEANUP_DISPLAY_SCRIPT, id: generateId() }

	return [...filtered, prompt, deepCleanupAi, display, deepCleanupDisplay]
}

export function unregisterCNRegexScripts(regexArr: Record<string, unknown>[]): Record<string, unknown>[] {
	if (!Array.isArray(regexArr)) {
		return []
	}
	return regexArr.filter(
		(s) => typeof s.scriptName === 'string' && !s.scriptName.startsWith(CN_REGEX_PREFIX)
	)
}
