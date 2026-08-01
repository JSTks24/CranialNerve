import type { CranialNerveSession } from '../session'
import { buildTableEditPrompt } from './prompt-builder'
import type { PromptContext, RunResult, FillProgressFn } from './retry-loop'
import { syncToWorldbook, buildBookName } from '../worldbook-sync'
import { CHRONICLE_TABLE_NAME, DEFAULT_CHRONICLE_TABLE } from '@shared/constants/chronicle'
import { getTimePromptDescription } from '../time'
import { scanEntries } from '../worldbook/entry-scanner'
import type { ScanEntry } from '@shared/types/worldbook-scanner'
import { pushLog } from '@shared/log-buffer'
import type { WorldInfoEntry } from '@shared/types/worldbook'
import { getHostContext } from '@db/gateways/host-context'
import { getPersonaDescription, getCharDescription, getUserName } from '@db/gateways/host-state'
import type { TableDef } from '@shared/types/table'
import { createPersistContext, ensureInitCheckpoint, appendSqlLog } from '@db/sqlite/frame-persist'
import { buildSnapshotFromCore } from '@db/sqlite/snapshot-builder'
import { quoteIdent } from '@shared/template-builder'
import type { MutationOperation } from '@shared/types/storage-frame'

let generationCountSinceLastFill = 0
let fillInProgress = false
let lastGenerationWasStopped = false
let lastAiLenAtStart: number | null = null

function getLastAiLength(session: CranialNerveSession): number | null {
	const chat = session.chat.getChat()
	for (let i = chat.length - 1; i >= 0; i--) {
		const m = chat[i]
		if (m && !m.is_user && !m.is_system) {
			return m.mes?.length ?? 0
		}
	}
	return null
}

export function snapshotLastAiLength(session: CranialNerveSession): void {
	lastAiLenAtStart = getLastAiLength(session)
}

export function markGenerationStopped(): void {
	lastGenerationWasStopped = true
}

export function resetGenerationStopped(): void {
	lastGenerationWasStopped = false
}

export function resetFillScheduler(): void {
	generationCountSinceLastFill = 0
}

export function isFillInProgress(): boolean {
	return fillInProgress
}

function isAbortError(e: unknown, signal?: AbortSignal): boolean {
	if (signal?.aborted) {
		return true
	}
	if (e instanceof DOMException && e.name === 'AbortError') {
		return true
	}
	return false
}

export interface ExecuteFillOptions {
	targetTables?: string[]
	includeChronicle?: boolean
	contextDepth?: number
	skipFloors?: number
	batchSize?: number
	extraHint?: string
	persistMessageId?: number
	conversationText?: string
	clearBeforeFill?: boolean
	clearTables?: string[]
	onProgress?: FillProgressFn
	messages?: SillyTavernChatMessage[]
}

async function executeFill(session: CranialNerveSession, opts?: ExecuteFillOptions): Promise<RunResult> {
	if (fillInProgress) {
		pushLog('warn', 'fill', '已有填表进行中，跳过本次触发')
		return { ok: false, attempts: 0, error: 'fill in progress' }
	}
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

	const contextDepth = opts?.contextDepth != null
		? (opts.contextDepth > 0 ? opts.contextDepth : 10)
		: (config.tableFill.contextDepth > 0 ? config.tableFill.contextDepth : 10)

	const skipFloors = Math.max(0, opts?.skipFloors != null ? opts.skipFloors : (config.tableFill.skipFloors || 0))
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

	const batchSize = Math.max(1, opts?.batchSize != null ? opts.batchSize : (config.tableFill.batchSize || 3))
	const userName = getUserName()
	const messagesToProcess = opts?.messages != null
		? opts.messages
		: effectiveMessages.slice(-Math.min(contextDepth, effectiveMessages.length))
	const buckets: typeof messagesToProcess[] = []
	for (let i = 0; i < messagesToProcess.length; i += batchSize) {
		buckets.push(messagesToProcess.slice(i, i + batchSize))
	}
	if (buckets.length === 0) {
		return { ok: false, attempts: 0, error: 'no messages to fill' }
	}
	const totalBuckets = buckets.length

	const segments = session.getActiveSegments('tableEdit')
	const chronicleEnabled = opts?.includeChronicle != null ? opts.includeChronicle : config.chronicleGenEnabled
	const chronicleTable = config.chronicleTableDef ?? DEFAULT_CHRONICLE_TABLE
	const tableDefs: TableDef[] = chronicleEnabled
		? [...template.tables, chronicleTable]
		: [...template.tables]
	const defaultTargetTables = chronicleEnabled
		? [...template.tables.map((t) => t.name), CHRONICLE_TABLE_NAME]
		: template.tables.map((t) => t.name)
	const targetTables = opts?.targetTables != null ? opts.targetTables : defaultTargetTables

	const timeFormat = getTimePromptDescription(session.getChatToken())
	const personaDescription = getPersonaDescription()
	const charDescription = getCharDescription()

	const editor = session.getTableEditor()
	const repo = session.getSyncBridgeRepo()
	const persistCtx = repo ? createPersistContext(repo, session.core) : null

	const clearBeforeFill = opts?.clearBeforeFill === true
	const clearTables = opts?.clearTables ?? []
	const refillSnapshot = clearBeforeFill && clearTables.length > 0 ? buildSnapshotFromCore(session.core) : null

	const starter = session.getProgressNotifier()
	const progressText = clearBeforeFill
		? '正在重填选中表...'
		: (chronicleEnabled ? '正在生成纪要与更新表格...' : '正在更新表格...')
	const progress = starter?.(progressText)

	fillInProgress = true
	let lastResult: RunResult = { ok: false, attempts: 0, error: 'no bucket run' }
	let deleteStatements: string[] = []
	try {
		if (clearBeforeFill && clearTables.length > 0) {
			deleteStatements = clearTables.map((t) => `DELETE FROM ${quoteIdent(t)}`)
			try {
				session.core.transaction(() => {
					for (const stmt of deleteStatements) {
						session.core.run(stmt)
					}
				})
			} catch (e) {
				if (refillSnapshot) session.applySnapshot(refillSnapshot)
				progress?.fail(e instanceof Error ? e.message : String(e))
				pushLog('error', 'fill', `重填清理失败: ${e instanceof Error ? e.message : String(e)}`)
				return { ok: false, attempts: 0, error: e instanceof Error ? e.message : String(e) }
			}
		}

		for (let b = 0; b < totalBuckets; b++) {
			const batch = buckets[b]!
			const conversationText = batch
				.map((m) => `${m.is_user ? userName : 'Assistant'}: ${m.mes}`)
				.join('\n')
			const worldbookContent = await buildWorldbookContext(session, conversationText)
			const filledSegments = buildTableEditPrompt(session.core, {
				tableDefs,
				targetTables,
				worldbookContent,
				conversationText,
				timeFormat,
				segments,
				extraHint: opts?.extraHint,
				personaDescription,
				charDescription
			})
			const promptCtx: PromptContext = {
				segments: filledSegments,
				userPrompt: '请根据以上故事内容更新数据库表格。',
				clientConfig: { baseURL: preset.baseURL, apiKey: preset.apiKey, customIncludeBody: preset.customIncludeBody, customExcludeBody: preset.customExcludeBody, customIncludeHeaders: preset.customIncludeHeaders },
				params: {
					model: preset.model,
					max_tokens: preset.maxTokens,
					temperature: preset.temperature,
					top_p: preset.topP,
					frequency_penalty: preset.frequencyPenalty,
					presence_penalty: preset.presencePenalty,
					seed: preset.seed ?? undefined,
					stream: preset.stream,
				},
				callOptions: {
					timeoutMs: config.pending.aiCallTimeoutMs,
					timeoutRetries: config.pending.aiTimeoutRetries
				}
			}
			const batchLastMsg = batch[batch.length - 1]!
			const targetMsgId = opts?.persistMessageId != null ? opts.persistMessageId : chatMessages.indexOf(batchLastMsg)
			if (persistCtx && targetMsgId >= 0 && !clearBeforeFill) {
				ensureInitCheckpoint(persistCtx, targetMsgId, session.getCurrentTemplateId() ?? undefined)
			}
			const persist = persistCtx && targetMsgId >= 0 ? { ctx: persistCtx, messageId: targetMsgId } : undefined

			pushLog('info', 'fill', `填表 bucket ${b + 1}/${totalBuckets}（消息 ${targetMsgId}）`)
			const result = await session.getWriteQueue().enqueue(() =>
				editor.run(promptCtx, { maxRetries: config.tableFill.maxRetries, signal: progress?.abortSignal, onProgress: opts?.onProgress ? (p, d) => opts.onProgress!(p, { ...d, currentBucket: b + 1, totalBuckets }) : undefined }, persist)
			)
			lastResult = result
			if (!result.ok) {
				if (refillSnapshot) session.applySnapshot(refillSnapshot)
				progress?.fail(result.error ?? '填表失败')
				return result
			}
			if (persistCtx && targetMsgId >= 0) {
				const ops: MutationOperation[] = []
				if (b === 0 && deleteStatements.length > 0) {
					ops.push({ kind: 'sql_batch', statements: deleteStatements, reason: 'manual_refill' })
				}
				if (result.lastSql) {
					ops.push({ kind: 'sql_batch', statements: [result.lastSql], reason: 'ai_fill' })
				}
				if (ops.length > 0) {
					appendSqlLog(persistCtx, targetMsgId, ops)
				}
			}
			if (targetMsgId >= 0) {
				session.cleanupOldSnapshots(config.retainFloors)
			}
		}

		generationCountSinceLastFill = 0
		try {
			await syncToWorldbook(session)
		} catch (e) {
			pushLog('error', 'worldbook', `世界书同步失败: ${e instanceof Error ? e.message : String(e)}`)
		}
		progress?.done()
		return lastResult
	} catch (e) {
		if (refillSnapshot) {
			try { session.applySnapshot(refillSnapshot) } catch {}
		}
		if (isAbortError(e, progress?.abortSignal)) {
			progress?.fail('操作已终止')
			pushLog('info', 'fill', '填表被用户终止')
			return { ok: false, attempts: 0, error: 'aborted' }
		}
		progress?.fail(e instanceof Error ? e.message : String(e))
		pushLog('error', 'fill', `填表异常: ${e instanceof Error ? e.message : String(e)}`)
		return { ok: false, attempts: 0, error: e instanceof Error ? e.message : String(e) }
	} finally {
		fillInProgress = false
	}
}

export async function onGenerationEnded(session: CranialNerveSession, opts?: { force?: boolean }): Promise<void> {
	const force = opts?.force === true
	const config = session.getConfig()
	pushLog('info', 'fill', `onGenerationEnded 开始 autoFill=${config.tableFill.autoFill} force=${force}`)

	if (!config.tableFill.autoFill) {
		pushLog('info', 'fill', 'autoFill 关闭，跳过纪要总结与表格更新')
		return
	}

	const lastAiLenNow = getLastAiLength(session)
	if (lastAiLenNow === lastAiLenAtStart) {
		pushLog('info', 'fill', `AI输出无新增（生成错误/中断）len=${lastAiLenNow}，跳过纪要总结与表格更新`)
		resetGenerationStopped()
		return
	}

	if (!force) {
		const frequency = Math.max(0, config.tableFill.updateFrequency ?? 1)
		if (frequency <= 0) {
			pushLog('info', 'fill', 'frequency<=0，跳过纪要总结与表格更新')
			return
		}
		generationCountSinceLastFill++
		if (generationCountSinceLastFill < frequency) {
			pushLog('info', 'fill', `计数 ${generationCountSinceLastFill}/${frequency} 未达，跳过纪要总结与表格更新`)
			return
		}
	}

	await Promise.resolve()
	if (lastGenerationWasStopped && !config.pending.summarizeOnManualAbort) {
		pushLog('info', 'fill', '手动中止且未开启中止触发，跳过本轮纪要总结与表格更新')
		resetGenerationStopped()
		return
	}
	resetGenerationStopped()

	const minLen = Math.max(0, config.pending.minSummaryLength ?? 0)
	if (minLen > 0) {
		const chat = session.chat.getChat()
		let lastAiLen = 0
		for (let i = chat.length - 1; i >= 0; i--) {
			const m = chat[i]
			if (m && !m.is_user && !m.is_system) {
				lastAiLen = m.mes?.length ?? 0
				break
			}
		}
		if (lastAiLen < minLen) {
			pushLog('info', 'fill', `AI回复字数 ${lastAiLen} < ${minLen}，跳过纪要总结与表格更新`)
			return
		}
	}

	pushLog('info', 'fill', '准备执行纪要总结与表格更新 executeFill')
	await executeFill(session)
}

export async function runManualFill(session: CranialNerveSession, opts?: ExecuteFillOptions): Promise<RunResult> {
	const result = await executeFill(session, opts)
	if (result.ok) {
		generationCountSinceLastFill = 0
	}
	return result
}

export interface ManualCatchUpOptions {
	targetTables?: string[]
	includeChronicle?: boolean
	fromAiFloor?: number
	toAiFloor?: number
	batchSize?: number
	extraHint?: string
	persistMessageId?: number
	onProgress?: FillProgressFn
}

export function detectLastSummarizedAiFloor(session: CranialNerveSession): number | null {
	const repo = session.getSyncBridgeRepo()
	if (!repo) return null
	const chat = session.chat.getChat()
	let lastSummarized: number | null = null
	for (let i = 0; i < chat.length; i++) {
		const msg = chat[i]
		if (!msg || msg.is_user || msg.is_system) continue
		const frame = repo.loadFrame(i)
		if (!frame) continue
		const hasAiFill = frame.logEntries.some((entry) =>
			entry.operations.some((op) => op.kind === 'sql_batch' && op.reason === 'ai_fill')
		)
		if (hasAiFill) lastSummarized = i
	}
	return lastSummarized
}

export async function runManualCatchUp(session: CranialNerveSession, opts?: ManualCatchUpOptions): Promise<RunResult> {
	const chat = session.chat.getChat()
	const aiFloors: number[] = []
	for (let i = 0; i < chat.length; i++) {
		const msg = chat[i]
		if (msg && !msg.is_user && !msg.is_system) aiFloors.push(i)
	}
	if (aiFloors.length === 0) {
		return { ok: false, attempts: 0, error: '无 AI 楼层可追平' }
	}
	const lastSummarized = detectLastSummarizedAiFloor(session)
	const fromIdx = opts?.fromAiFloor != null
		? opts.fromAiFloor
		: (lastSummarized != null && lastSummarized >= 0
			? aiFloors.find((idx) => idx > lastSummarized) ?? aiFloors[aiFloors.length - 1]!
			: aiFloors[0]!)
	const toIdx = opts?.toAiFloor != null
		? opts.toAiFloor
		: aiFloors[aiFloors.length - 1]!
	if (fromIdx > toIdx) {
		return { ok: false, attempts: 0, error: '所选范围已追平，无需处理' }
	}
	const sliceMessages = chat.slice(fromIdx, toIdx + 1)
	return executeFill(session, {
		targetTables: opts?.targetTables,
		includeChronicle: opts?.includeChronicle,
		messages: sliceMessages,
		batchSize: opts?.batchSize,
		extraHint: opts?.extraHint,
		persistMessageId: opts?.persistMessageId ?? toIdx,
		onProgress: opts?.onProgress,
	})
}

export async function buildWorldbookContext(session: CranialNerveSession, scanText: string): Promise<string> {
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
	} catch (e) {
		pushLog('warn', 'worldbook', `读取 CN 书 ${cnBookName} 失败: ${e instanceof Error ? e.message : String(e)}`)
	}

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
