import type { CranialNerveSession } from '../session'
import { buildTableEditPrompt } from './prompt-builder'
import type { PromptContext, RunResult } from './retry-loop'
import { syncToWorldbook } from '../worldbook-sync'
import { CHRONICLE_TABLE_NAME, DEFAULT_CHRONICLE_TABLE } from '@shared/constants/chronicle'
import { getTimePromptDescription } from '../time'
import type { TableDef } from '@shared/types/table'

// ── 填表调度状态（模块级单例） ──
let generationCountSinceLastFill = 0

/** 重置调度状态（切聊天时调用） */
export function resetFillScheduler(): void {
	generationCountSinceLastFill = 0
}

async function executeFill(session: CranialNerveSession): Promise<RunResult> {
	const preset = session.getActiveAiPreset()
	if (!preset) {
		return { ok: false, attempts: 0, error: 'no active AI preset' }
	}

	const template = session.getTemplate()
	if (!template || template.tables.length === 0) {
		return { ok: false, attempts: 0, error: 'no template loaded' }
	}

	const config = session.getConfig()
	const chatMessages = session.chat.getChat()

	// ── 上下文深度（0=不传任何上下文） ──
	const contextDepth =
		config.tableFill.contextDepth > 0 ? config.tableFill.contextDepth : 10

	// ── 跳过楼层：忽略最近 N 条 AI 回复 ──
	const skipFloors = Math.max(0, config.tableFill.skipFloors || 0)
	const allAiMessages = chatMessages.filter((m) => !m.is_user)

	// 构建有效消息窗口：排除 skipFloors 条最新 AI 消息
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

	// ── 批处理大小：从有效窗口中取最后 batchSize 条 ──
	const batchSize = Math.max(1, config.tableFill.batchSize || 3)
	const recentMessages = effectiveMessages.slice(-Math.min(contextDepth, effectiveMessages.length))
	// 如果 batchSize < 实际取到的消息数，再截一次
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

	const tableDefs: TableDef[] = [...template.tables, DEFAULT_CHRONICLE_TABLE]
	const targetTables = [...template.tables.map((t) => t.name), CHRONICLE_TABLE_NAME]

	const timeFormat = getTimePromptDescription()

	const filledSegments = buildTableEditPrompt(session.core, {
		tableDefs,
		targetTables,
		worldbookContent,
		conversationText,
		timeFormat,
		segments
	})

	const userPrompt = '请根据以上故事内容更新数据库表格。'

	const promptCtx: PromptContext = {
		segments: filledSegments,
		userPrompt,
		clientConfig: { baseURL: preset.baseURL, apiKey: preset.apiKey },
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
		}
		// 更新调度状态
		generationCountSinceLastFill = 0
		try {
			await syncToWorldbook(session)
		} catch (_) {}
	}

	return result
}

export async function onGenerationEnded(session: CranialNerveSession): Promise<void> {
	const config = session.getConfig()

	// ── 自动填表总开关 ──
	if (!config.tableFill.autoFill) {
		return
	}

	// ── 更新频率：积累 N 次生成后才触发 ──
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

export async function runManualFill(session: CranialNerveSession): Promise<RunResult> {
	// 手动填表忽略频率限制，直接执行
	const result = await executeFill(session)
	// 手动填表后也重置计数器
	if (result.ok) {
		generationCountSinceLastFill = 0
	}
	return result
}
