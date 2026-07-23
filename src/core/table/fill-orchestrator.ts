import type { CranialNerveSession } from '../session'
import { buildTableEditPrompt } from './prompt-builder'
import type { PromptContext, RunResult } from './retry-loop'
import { syncToWorldbook } from '../worldbook-sync'
import { CHRONICLE_TABLE_NAME, DEFAULT_CHRONICLE_TABLE } from '@shared/constants/chronicle'
import { getTimePromptDescription } from '../time'
import type { TableDef } from '@shared/types/table'

let generationCountSinceLastFill = 0

export function resetFillScheduler(): void {
	generationCountSinceLastFill = 0
}

async function executeFill(session: CranialNerveSession, extraHint?: string): Promise<RunResult> {
	const cfg = session.getConfig()
	const preset = session.getAiPresetForScene(cfg.tableFillPresetId)
	if (!preset) {
		return { ok: false, attempts: 0, error: 'no active AI preset' }
	}

	const template = session.getTemplate()
	if (!template || template.tables.length === 0) {
		return { ok: false, attempts: 0, error: 'no template loaded' }
	}

	const config = session.getConfig()
	const chatMessages = session.chat.getChat()

	const contextDepth =
		config.tableFill.contextDepth > 0 ? config.tableFill.contextDepth : 10

	const skipFloors = Math.max(0, config.tableFill.skipFloors || 0)
	const allAiMessages = chatMessages.filter((m) => !m.is_user)

	let effectiveMessages = chatMessages
	if (skipFloors > 0 && allAiMessages.length > skipFloors) {
		const cutoffMsg = allAiMessages[allAiMessages.length - 1 - skipFloors]
		if (cutoffMsg) {
			const cutoffGlobalIndex = chatMessages.indexOf(cutoffMsg)
			if (cutoffGlobalIndex >= 0) {
				effectiveMessages = chatMessages.slice(0, cutoffGlobalIndex + 1)
			}
		}
	}

	const batchSize = Math.max(1, config.tableFill.batchSize || 3)
	const recentMessages = effectiveMessages.slice(-Math.min(contextDepth, effectiveMessages.length))
	const batchedMessages = recentMessages.slice(-batchSize)

	const conversationText = batchedMessages
		.map((m) => `${m.is_user ? 'User' : 'Assistant'}: ${m.mes}`)
		.join('\n')

	let worldbookContent = ''
	const lorebookName = session.worldbook.getCurrentCharLorebookName()
	if (lorebookName) {
		try {
			const data = await session.worldbook.loadLorebook(lorebookName)
			worldbookContent = JSON.stringify(data)
		} catch (_) {}
	}

	const segments = session.getActiveSegments('tableEdit')
	const chronicleGenSegments = session.getActiveSegments('chronicleGenerate')
	const chronicleGuide = chronicleGenSegments.map((s) => s.content).join('\n\n')

	const tableDefs: TableDef[] = [...template.tables, DEFAULT_CHRONICLE_TABLE]
	const targetTables = [...template.tables.map((t) => t.name), CHRONICLE_TABLE_NAME]

	const timeFormat = getTimePromptDescription()

	const filledSegments = buildTableEditPrompt(session.core, {
		tableDefs,
		targetTables,
		worldbookContent,
		conversationText,
		timeFormat,
		segments,
		extraHint,
		chronicleGuide
	})

	const userPrompt = '请根据以上故事内容更新数据库表格。'

	const promptCtx: PromptContext = {
		segments: filledSegments,
		userPrompt,
		clientConfig: { baseURL: preset.baseURL, apiKey: preset.apiKey, customIncludeBody: preset.customIncludeBody, customExcludeBody: preset.customExcludeBody, customIncludeHeaders: preset.customIncludeHeaders },
		params: { model: preset.model }
	}

	const editor = session.getTableEditor()
	const result = await session.getWriteQueue().enqueue(() =>
		editor.run(promptCtx, { maxRetries: config.tableFill.maxRetries })
	)

	if (result.ok) {
		const lastMsgId = chatMessages.length - 1
		if (lastMsgId >= 0) {
			session.saveToChat(lastMsgId)
			session.cleanupOldSnapshots(config.retainFloors)
		}
		generationCountSinceLastFill = 0
		try {
			await syncToWorldbook(session)
		} catch (_) {}
	}

	return result
}

export async function onGenerationEnded(session: CranialNerveSession): Promise<void> {
	const config = session.getConfig()

	if (!config.tableFill.autoFill) {
		return
	}

	const frequency = Math.max(0, config.tableFill.updateFrequency || 1)
	if (frequency <= 0) {
		return
	}
	generationCountSinceLastFill++
	if (generationCountSinceLastFill < frequency) {
		return
	}

	await executeFill(session)
}

export async function runManualFill(session: CranialNerveSession, extraHint?: string): Promise<RunResult> {
	const result = await executeFill(session, extraHint)
	if (result.ok) {
		generationCountSinceLastFill = 0
	}
	return result
}
