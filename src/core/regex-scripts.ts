import { getHostContext } from '@db/gateways/host-context'

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

function generateId(): string {
	return 'cn_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36)
}

export function registerCNRegexScripts(): void {
	const ctx = getHostContext()
	if (!Array.isArray(ctx.extensionSettings.regex)) {
		ctx.extensionSettings.regex = []
	}
	const scripts: Record<string, unknown>[] = Array.isArray(ctx.extensionSettings.regex)
		? (ctx.extensionSettings.regex as Record<string, unknown>[])
		: []

	const filtered = scripts.filter(
		(s) => typeof s.scriptName === 'string' && !s.scriptName.startsWith(CN_REGEX_PREFIX)
	)

	const prompt = { ...PROMPT_SCRIPT, id: generateId() }
	const display = { ...DISPLAY_SCRIPT, id: generateId() }

	ctx.extensionSettings.regex = [...filtered, prompt, display]
}

export function unregisterCNRegexScripts(): void {
	const ctx = getHostContext()
	if (!Array.isArray(ctx.extensionSettings.regex)) {
		return
	}
	ctx.extensionSettings.regex = ctx.extensionSettings.regex.filter(
		(s: Record<string, unknown>) =>
			typeof s.scriptName === 'string' && !s.scriptName.startsWith(CN_REGEX_PREFIX)
	)
}
