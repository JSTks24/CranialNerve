import type { CranialNerveSession } from '../session'
import { buildTableEditPrompt } from './prompt-builder'
import type { PromptContext, RunResult } from './retry-loop'
import { syncToWorldbook, buildBookName } from '../worldbook-sync'
import { CHRONICLE_TABLE_NAME, DEFAULT_CHRONICLE_TABLE } from '@shared/constants/chronicle'
import { getTimePromptDescription } from '../time'
import { scanEntries } from '../worldbook/entry-scanner'
import type { ScanEntry } from '@shared/types/worldbook-scanner'
import { pushLog } from '@shared/log-buffer'
import type { WorldInfoEntry } from '@shared/types/worldbook'
import { getHostContext } from '@db/gateways/host-context'
import type { TableDef } from '@shared/types/table'
import { createPersistContext } from '@db/sqlite/frame-persist'
import { ensureInitCheckpoint } from '@db/sqlite/frame-persist'

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

	const worldbookContent = await buildWorldbookContext(session, conversationText)

	const segments = session.getActiveSegments('tableEdit')
	const chronicleEnabled = config.chronicleGenEnabled
	const chronicleGuide = chronicleEnabled
		? session.getActiveSegments('chronicleGenerate').map((s) => s.content).join('\n\n')
		: ''
	const tableDefs: TableDef[] = chronicleEnabled
		? [...template.tables, DEFAULT_CHRONICLE_TABLE]
		: [...template.tables]
	const targetTables = chronicleEnabled
		? [...template.tables.map((t) => t.name), CHRONICLE_TABLE_NAME]
		: template.tables.map((t) => t.name)

	const timeFormat = getTimePromptDescription(session.getChatToken())

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
		params: {
			model: preset.model,
			max_tokens: preset.maxTokens,
			temperature: preset.temperature,
			top_p: preset.topP,
			frequency_penalty: preset.frequencyPenalty,
			presence_penalty: preset.presencePenalty,
			seed: preset.seed >= 0 ? preset.seed : undefined,
			stream: preset.stream,
		}
	}

	const editor = session.getTableEditor()
	const targetMsgId = chatMessages.length - 1
	const repo = session.getSyncBridgeRepo()
	const persistCtx = repo ? createPersistContext(repo, session.core) : null
	if (persistCtx && targetMsgId >= 0) {
		ensureInitCheckpoint(persistCtx, targetMsgId)
	}
	const persist = persistCtx && targetMsgId >= 0 ? { ctx: persistCtx, messageId: targetMsgId } : undefined
	const result = await session.getWriteQueue().enqueue(() =>
		editor.run(promptCtx, { maxRetries: config.tableFill.maxRetries }, persist)
	)

	if (result.ok) {
		if (targetMsgId >= 0) {
			session.cleanupOldSnapshots(config.retainFloors)
		}
		generationCountSinceLastFill = 0
		try {
			await syncToWorldbook(session)
		} catch (e) {
			pushLog('error', 'worldbook', `世界书同步失败: ${e instanceof Error ? e.message : String(e)}`)
		}
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

async function buildWorldbookContext(session: CranialNerveSession, scanText: string): Promise<string> {
	const scanEntriesList: ScanEntry[] = []
	const charBookName = session.worldbook.getCurrentCharLorebookName()
	if (charBookName) {
		try {
			const data = await session.worldbook.loadLorebook(charBookName)
			for (const entry of Object.values(data.entries)) {
				scanEntriesList.push(worldInfoToScanEntry(entry, charBookName))
			}
		} catch (e) {
			pushLog('error', 'worldbook', `读取角色世界书失败: ${charBookName}`)
		}
	}
	const cnBookName = buildBookName(session.getChatToken())
	try {
		const data = await session.worldbook.loadLorebook(cnBookName)
		for (const entry of Object.values(data.entries)) {
			scanEntriesList.push(worldInfoToScanEntry(entry, cnBookName))
		}
	} catch {}

	if (scanEntriesList.length === 0) {
		return ''
	}

	const ctx = getHostContext()
	const characters = ctx.characters as Record<number, { name?: string }> | undefined
	const charId = ctx.characterId
	const characterName: string = charId != null ? (characters?.[Number(charId)]?.name ?? '') : ''

	const active = scanEntries(scanEntriesList, scanText, {
		trigger: 'normal',
		characterName,
	})

	if (active.length === 0) {
		return ''
	}

	return active.map((e) => e.content).join('\n\n')
}

function worldInfoToScanEntry(entry: WorldInfoEntry, bookName: string): ScanEntry {
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
