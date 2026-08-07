import type { CranialNerveSession } from '../session'
import { buildTableEditPrompt, buildChronicleGenPrompt, buildMergedPrompt } from './prompt-builder'
import type { PromptContext, RunResult, FillProgressFn } from './retry-loop'
import { syncToWorldbook, buildBookName } from '../worldbook-sync'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import { getDefaultChronicleTable } from '@db/gateways/template'
import { getTimePromptDescription } from '../time'
import { scanEntries } from '../worldbook/entry-scanner'
import type { ScanEntry } from '@shared/types/worldbook-scanner'
import { pushLog } from '@shared/log-buffer'
import type { WorldInfoEntry } from '@shared/types/worldbook'
import { getHostContext } from '@db/gateways/host-context'
import { getPersonaDescription, getCharDescription, getUserName } from '@db/gateways/host-state'
import type { TableDef } from '@shared/types/table'
import type { PromptSegment } from '@shared/types/config'
import { buildSnapshotFromCore } from '@db/sqlite/snapshot-builder'
import { quoteIdent } from '@shared/template-builder'
import type { MutationOperation, SqlBatchOperation } from '@shared/types/storage-frame'
import { sqlMentionsTable } from './sql-mentions'

let tableCountSinceLastFill = 0
let chronicleCountSinceLastFill = 0
let fillInProgress = false
let fillRunMode: FillRunMode | null = null
let lastGenerationWasStopped = false
let lastAiLenAtStart: number | null = null

export interface FillProgressState {
	tick: number
	currentBucket: number
	totalBuckets: number
	tableFloor: number | null
	chronicleFloor: number | null
	tokenWarn: { estimatedTokens: number; maxTokens: number } | null
}

let fillProgressState: FillProgressState | null = null

const fillStateSubscribers: Array<(busy: boolean, runMode: FillRunMode | null, progress: FillProgressState | null) => void> = []

export function subscribeFillState(cb: (busy: boolean, runMode: FillRunMode | null, progress: FillProgressState | null) => void): () => void {
	fillStateSubscribers.push(cb)
	return () => {
		const idx = fillStateSubscribers.indexOf(cb)
		if (idx >= 0) fillStateSubscribers.splice(idx, 1)
	}
}

export function getFillState(): { busy: boolean, runMode: FillRunMode | null, progress: FillProgressState | null } {
	return { busy: fillInProgress, runMode: fillRunMode, progress: fillProgressState }
}

function notifyFillState(): void {
	for (const fn of fillStateSubscribers) {
		try { fn(fillInProgress, fillRunMode, fillProgressState) } catch {}
	}
}

function fillProgressStateTick(): number {
	return fillProgressState?.tick ?? 0
}

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
	tableCountSinceLastFill = 0
	chronicleCountSinceLastFill = 0
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

export type FillRunMode = 'table' | 'chronicle' | 'merged'

const ESTIMATED_TOKENS_PER_FLOOR = 400

export interface ExecuteFillOptions {
	runMode?: FillRunMode
	fillCfgSource?: 'table' | 'chronicle'
	targetTables?: string[]
	contextDepth?: number
	skipFloors?: number
	batchSize?: number
	extraHint?: string
	conversationText?: string
	clearBeforeFill?: boolean
	clearTables?: string[]
	onProgress?: FillProgressFn
	messages?: SillyTavernChatMessage[]
	suppressProgressNotifier?: boolean
	signal?: AbortSignal
}

async function executeFill(session: CranialNerveSession, opts?: ExecuteFillOptions): Promise<RunResult> {
	if (fillInProgress) {
		pushLog('warn', 'fill', '已有填表进行中，跳过本次触发')
		return { ok: false, attempts: 0, error: 'fill in progress' }
	}
	const cfg = session.getConfig()
	const runMode = opts?.runMode ?? 'table'

	const fillCfgSource = opts?.fillCfgSource ?? (runMode === 'chronicle' ? 'chronicle' : 'table')
	const presetId = runMode === 'chronicle'
		? cfg.chronicleGenPresetId
		: runMode === 'merged'
			? (fillCfgSource === 'chronicle' ? cfg.chronicleGenPresetId : cfg.tableFillPresetId)
			: cfg.tableFillPresetId
	const preset = session.getAiPresetForScene(presetId)
	if (!preset) {
		return { ok: false, attempts: 0, error: 'no active AI preset' }
	}

	const template = session.getTemplate()
	const activeTables = (template?.tables ?? []).filter((t) => t.enabled !== false)
	const needsTables = runMode === 'table' || runMode === 'merged'
	if (needsTables && activeTables.length === 0) {
		return { ok: false, attempts: 0, error: 'no template loaded' }
	}

	const config = session.getConfig()
	const chatMessages = session.chat.getChat()

	const fillCfg = fillCfgSource === 'chronicle' ? config.chronicleFill : config.tableFill

	const contextDepth = opts?.contextDepth != null
		? (opts.contextDepth > 0 ? opts.contextDepth : 10)
		: (fillCfg.contextDepth > 0 ? fillCfg.contextDepth : 10)

	const skipFloors = Math.max(0, opts?.skipFloors != null ? opts.skipFloors : (fillCfg.skipFloors || 0))
	const allAiMessages = chatMessages.filter((m) => !m.is_user && !m.is_system)

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

	const batchSize = Math.max(1, opts?.batchSize != null ? opts.batchSize : (fillCfg.batchSize || 10))
	const userName = getUserName()
	let messagesToProcess: typeof chatMessages
	if (opts?.messages != null) {
		messagesToProcess = opts.messages
	} else {
		const effAiIdx: number[] = []
		for (let i = 0; i < effectiveMessages.length; i++) {
			if (!effectiveMessages[i]!.is_user && !effectiveMessages[i]!.is_system) effAiIdx.push(i)
		}
		const takeCount = contextDepth > 0 ? Math.min(contextDepth, effAiIdx.length) : effAiIdx.length
		if (takeCount === 0 || effAiIdx.length === 0) {
			messagesToProcess = []
		} else {
			const startAi = effAiIdx[effAiIdx.length - takeCount]!
			const lastAi = effAiIdx[effAiIdx.length - 1]!
			let startMsg = startAi
			if (startMsg > 0 && effectiveMessages[startMsg - 1]!.is_user) startMsg = startMsg - 1
			messagesToProcess = effectiveMessages.slice(startMsg, lastAi + 1)
		}
	}
	const aiIndices: number[] = []
	for (let i = 0; i < messagesToProcess.length; i++) {
		if (!messagesToProcess[i]!.is_user && !messagesToProcess[i]!.is_system) aiIndices.push(i)
	}
	const buckets: typeof messagesToProcess[] = []
	for (let i = 0; i < aiIndices.length; i += batchSize) {
		const batchAi = aiIndices.slice(i, i + batchSize)
		const firstAi = batchAi[0]!
		const lastAi = batchAi[batchAi.length - 1]!
		let start = firstAi
		if (start > 0 && messagesToProcess[start - 1]!.is_user) start = start - 1
		buckets.push(messagesToProcess.slice(start, lastAi + 1))
	}
	if (buckets.length === 0) {
		return { ok: false, attempts: 0, error: 'no messages to fill' }
	}
	const totalBuckets = buckets.length

	const tableSegments = (runMode === 'table' || runMode === 'merged') ? session.getActiveSegments('tableEdit') : []
	const chronicleSegments = (runMode === 'chronicle' || runMode === 'merged') ? session.getActiveSegments('chronicleGen') : []
	const chronicleTableDef = config.chronicleTableDef ?? getDefaultChronicleTable() ?? { name: CHRONICLE_TABLE_NAME, displayName: '纪要表', columns: [] }
	const chronicleSendLatestRows = config.chronicleFill.chronicleSendLatestRows
	const tableDefs: TableDef[] = activeTables
	const defaultTargetTables = activeTables.map((t) => t.name)
	const targetTables = opts?.targetTables != null ? opts.targetTables : defaultTargetTables

	const timeFormat = getTimePromptDescription(session.getChatToken())
	const personaDescription = getPersonaDescription()
	const charDescription = getCharDescription()

	const editor = session.getTableEditor()

	const clearBeforeFill = opts?.clearBeforeFill === true
	const clearTables = opts?.clearTables ?? []
	const refillSnapshot = clearBeforeFill && clearTables.length > 0 ? buildSnapshotFromCore(session.core) : null

	const starter = opts?.suppressProgressNotifier ? undefined : session.getProgressNotifier()
	const progressText = clearBeforeFill
		? '正在重填选中表...'
		: runMode === 'chronicle'
			? '正在生成纪要...'
			: runMode === 'merged'
				? '正在更新表格与生成纪要...'
				: '正在更新表格...'
	const progress = starter?.(progressText)

	fillInProgress = true
	fillRunMode = runMode
	fillProgressState = null
	notifyFillState()
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
			if (opts?.signal?.aborted) {
				throw new DOMException('Aborted', 'AbortError')
			}
			const batch = buckets[b]!
			const conversationText = batch
				.map((m) => `${m.is_user ? userName : 'Assistant'}: ${m.mes}`)
				.join('\n')
			const worldbookContent = await buildWorldbookContext(session, conversationText)
			let filledSegments: PromptSegment[]
			if (runMode === 'chronicle') {
				filledSegments = buildChronicleGenPrompt(session.core, {
					chronicleTableDef,
					chronicleSendLatestRows,
					worldbookContent,
					conversationText,
					timeFormat,
					segments: chronicleSegments,
					extraHint: opts?.extraHint,
					personaDescription,
					charDescription
				})
			} else if (runMode === 'merged') {
				filledSegments = buildMergedPrompt(session.core, {
					tableDefs,
					targetTables,
					chronicleTableDef,
					chronicleSendLatestRows,
					worldbookContent,
					conversationText,
					timeFormat,
					tableSegments,
					chronicleSegments,
					extraHint: opts?.extraHint,
					personaDescription,
					charDescription
				})
			} else {
				filledSegments = buildTableEditPrompt(session.core, {
					tableDefs,
					targetTables,
					worldbookContent,
					conversationText,
					timeFormat,
					segments: tableSegments,
					extraHint: opts?.extraHint,
					personaDescription,
					charDescription
				})
			}
			const promptCtx: PromptContext = {
				segments: filledSegments,
				userPrompt: runMode === 'chronicle' ? '请根据以上故事内容生成纪要。' : runMode === 'merged' ? '请根据以上故事内容执行上述所有数据库操作。' : '请根据以上故事内容更新数据库表格。',
				clientConfig: { baseURL: preset.baseURL, apiKey: preset.apiKey, customIncludeBody: preset.customIncludeBody, customExcludeBody: preset.customExcludeBody, customIncludeHeaders: preset.customIncludeHeaders, responseFormat: preset.responseFormat },
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
					timeoutRetries: config.pending.aiTimeoutRetries,
					scene: runMode === 'chronicle' ? 'chronicle-gen' : runMode === 'merged' ? 'merged-fill' : 'table-fill'
				}
			}
			const batchLastMsg = batch[batch.length - 1]!
			const bucketFloor = chatMessages.indexOf(batchLastMsg)
			const bucketAiFloors: number[] = []
			for (let i = 0; i < batch.length; i++) {
				const m = batch[i]
				if (m && !m.is_user && !m.is_system) {
					const gi = chatMessages.indexOf(m)
					if (gi >= 0) bucketAiFloors.push(gi)
				}
			}
			const chatRefAtBucket = session.chat.getChat()
			const bucketOps: MutationOperation[] = []
			pushLog('info', 'fill', `填表 bucket ${b + 1}/${totalBuckets}（末楼 ${bucketFloor}，模式 ${runMode}）`)
			const estimatedOutputTokens = bucketAiFloors.length * ESTIMATED_TOKENS_PER_FLOOR
			const tokenWarn = preset.maxTokens != null && estimatedOutputTokens > preset.maxTokens
				? { estimatedTokens: estimatedOutputTokens, maxTokens: preset.maxTokens }
				: null
			if (tokenWarn) {
				fillProgressState = {
					tick: fillProgressStateTick() + 1,
					currentBucket: b + 1,
					totalBuckets,
					tableFloor: readFillProgress(session)?.tableFloor ?? null,
					chronicleFloor: readFillProgress(session)?.chronicleFloor ?? null,
					tokenWarn,
				}
				notifyFillState()
			}
			const result = await session.getWriteQueue().enqueue(async () => {
				const r = await editor.run(promptCtx, {
					maxRetries: fillCfg.maxRetries,
					signal: opts?.signal ?? progress?.abortSignal,
					onProgress: opts?.onProgress ? (p, d) => opts.onProgress!(p, { ...d, currentBucket: b + 1, totalBuckets }) : undefined,
					expectedSqlObjects: bucketAiFloors.length,
					requireChronicleInsert: runMode === 'chronicle' || runMode === 'merged',
				})
				if (!r.ok) return r
				if (b === 0 && deleteStatements.length > 0) {
					const deleteOp: MutationOperation = { kind: 'sql_batch', statements: deleteStatements, reason: 'manual_refill' }
					bucketOps.push(deleteOp)
					if (session.chat.getChat() === chatRefAtBucket) {
						session.persistAfterFill(bucketFloor, [deleteOp])
					}
				}
				if (r.sqls) {
					for (let k = 0; k < r.sqls.length; k++) {
						const sql = r.sqls[k]!
						if (!sql.trim()) continue
						const floorId = bucketAiFloors[k]
						if (floorId == null || floorId < 0) continue
						const ops: MutationOperation[] = []
						for (const reason of reasonsForSql(runMode, sql, targetTables)) {
							ops.push({ kind: 'sql_batch', statements: [sql], reason })
						}
						if (ops.length === 0) continue
						bucketOps.push(...ops)
						if (session.chat.getChat() === chatRefAtBucket) {
							session.persistAfterFill(floorId, ops)
						} else {
							pushLog('warn', 'fill', `聊天已切换，丢弃 bucket ${b + 1} 的落帧`)
						}
					}
				}
				return r
			})
			lastResult = result
			if (!result.ok) {
				if (opts?.signal?.aborted || progress?.abortSignal?.aborted) {
					pushLog('info', 'fill', '填表被用户终止')
					return { ok: false, attempts: lastResult.attempts, error: 'aborted' }
				}
				if (refillSnapshot) {
					session.applySnapshot(refillSnapshot)
					progress?.fail(`${result.error ?? '填表失败'}（已回滚到填表前，期间手动编辑丢失）`)
					return result
				}
				progress?.fail(result.error ?? '填表失败')
				return result
			}
			const scenes = new Set<'table' | 'chronicle'>()
			if (runMode === 'table') scenes.add('table')
			else if (runMode === 'chronicle') scenes.add('chronicle')
			else {
				for (const op of bucketOps) {
					if (op.kind !== 'sql_batch') continue
					if (op.reason === 'ai_fill_table') scenes.add('table')
					if (op.reason === 'ai_fill_chronicle') scenes.add('chronicle')
				}
			}
			for (const s of scenes) updateFillProgress(session, s, bucketFloor)
			fillProgressState = {
				tick: fillProgressStateTick() + 1,
				currentBucket: b + 1,
				totalBuckets,
				tableFloor: readFillProgress(session)?.tableFloor ?? null,
				chronicleFloor: readFillProgress(session)?.chronicleFloor ?? null,
				tokenWarn,
			}
			notifyFillState()
		}

		if (runMode === 'table' || runMode === 'merged') tableCountSinceLastFill = 0
		if (runMode === 'chronicle' || runMode === 'merged') chronicleCountSinceLastFill = 0
		try {
			await syncToWorldbook(session)
		} catch (e) {
			pushLog('error', 'worldbook', `世界书同步失败: ${e instanceof Error ? e.message : String(e)}`)
		}
		if (lastResult?.ok) {
			try {
				await session.chat.saveChat()
			} catch (e) {
				pushLog('error', 'fill', `填表后保存失败: ${e instanceof Error ? e.message : String(e)}`)
			}
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
		const errMsg = e instanceof Error ? e.message : String(e)
		progress?.fail(refillSnapshot ? `${errMsg}（已回滚到填表前，期间手动编辑丢失）` : errMsg)
		pushLog('error', 'fill', `填表异常: ${errMsg}`)
		return { ok: false, attempts: 0, error: errMsg }
	} finally {
		fillInProgress = false
		fillRunMode = null
		fillProgressState = null
		notifyFillState()
	}
}

export async function onGenerationEnded(session: CranialNerveSession, opts?: { force?: boolean }): Promise<void> {
	const force = opts?.force === true
	const config = session.getConfig()
	const tableTrigger = config.tableFill.autoFillTrigger
	const chronicleTrigger = config.chronicleFill.autoFillTrigger
	const tableFreq = Math.max(0, config.tableFill.updateFrequency ?? 1)
	const chronicleFreq = Math.max(0, config.chronicleFill.updateFrequency ?? 1)
	const tableActive = tableTrigger === 'after-ai' && tableFreq > 0
	const chronicleActive = chronicleTrigger === 'after-ai' && chronicleFreq > 0
	const tableRegen = tableActive && config.tableFill.regenerateFill
	const chronicleRegen = chronicleActive && config.chronicleFill.regenerateFill
	pushLog('info', 'fill', `onGenerationEnded 开始 tableTrigger=${tableTrigger} chronicleTrigger=${chronicleTrigger} force=${force} tableRegen=${tableRegen} chronicleRegen=${chronicleRegen}`)

	if (!tableActive && !chronicleActive) {
		pushLog('info', 'fill', '两者均非 after-ai，不在 generation_ended 处理')
		return
	}

	const lastAiLenNow = getLastAiLength(session)
	if (!force && lastAiLenNow === lastAiLenAtStart) {
		pushLog('info', 'fill', `AI输出无新增（生成错误/中断）len=${lastAiLenNow}，跳过`)
		resetGenerationStopped()
		return
	}

	await Promise.resolve()
	if (lastGenerationWasStopped && !config.pending.summarizeOnManualAbort) {
		pushLog('info', 'fill', '手动中止且未开启中止触发，跳过本轮')
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
			pushLog('info', 'fill', `AI回复字数 ${lastAiLen} < ${minLen}，跳过本轮`)
			return
		}
	}

	if (!force) {
		if (tableActive) tableCountSinceLastFill++
		if (chronicleActive) chronicleCountSinceLastFill++
	}
	const tableReady = force ? tableRegen : (tableActive && tableCountSinceLastFill >= tableFreq)
	const chronicleReady = force ? chronicleRegen : (chronicleActive && chronicleCountSinceLastFill >= chronicleFreq)

	if (tableReady && chronicleReady) {
		const template = session.getTemplate()
		if (!template || (template.tables ?? []).filter((t) => t.enabled !== false).length === 0) {
			pushLog('info', 'fill', '无启用普通表，合并退化为只生成纪要')
			tableCountSinceLastFill = 0
			await executeFill(session, { runMode: 'chronicle' })
			return
		}
		pushLog('info', 'fill', '表格更新与纪要生成同轮触发，合并运行')
		await executeFill(session, { runMode: 'merged' })
		return
	}
	if (tableReady) {
		pushLog('info', 'fill', '执行表格更新')
		await executeFill(session, { runMode: 'table' })
		return
	}
	if (chronicleReady) {
		pushLog('info', 'fill', '执行纪要生成')
		await executeFill(session, { runMode: 'chronicle' })
		return
	}
	pushLog('info', 'fill', `未达触发条件 tableReady=${tableReady} chronicleReady=${chronicleReady}，跳过`)
}

export async function onMessageSentForFill(session: CranialNerveSession, userMsgId: number): Promise<void> {
	const config = session.getConfig()
	const tableActive = config.tableFill.autoFillTrigger === 'after-send'
	const chronicleActive = config.chronicleFill.autoFillTrigger === 'after-send'
	if (!tableActive && !chronicleActive) return

	const chat = session.chat.getChat()
	let lastAiId = -1
	for (let i = userMsgId - 1; i >= 0; i--) {
		const m = chat[i]
		if (m && !m.is_user && !m.is_system) {
			lastAiId = i
			break
		}
	}
	if (lastAiId < 0) {
		pushLog('info', 'fill', 'after-send：无上一轮 AI 回复，跳过')
		return
	}
	const fillCfg = tableActive ? config.tableFill : config.chronicleFill
	const sendContextDepth = fillCfg.contextDepth > 0 ? fillCfg.contextDepth : 10
	const upToLastAi = chat.slice(0, lastAiId + 1)
	const sendAiIdx: number[] = []
	for (let i = 0; i < upToLastAi.length; i++) {
		if (!upToLastAi[i]!.is_user && !upToLastAi[i]!.is_system) sendAiIdx.push(i)
	}
	const sendTake = Math.min(sendContextDepth, sendAiIdx.length)
	let messages: typeof chat
	if (sendTake === 0 || sendAiIdx.length === 0) {
		messages = []
	} else {
		const startAi = sendAiIdx[sendAiIdx.length - sendTake]!
		let startMsg = startAi
		if (startMsg > 0 && upToLastAi[startMsg - 1]!.is_user) startMsg = startMsg - 1
		messages = upToLastAi.slice(startMsg)
	}

	if (tableActive && chronicleActive) {
		const template = session.getTemplate()
		if (!template || (template.tables ?? []).filter((t) => t.enabled !== false).length === 0) {
			pushLog('info', 'fill', `after-send：无启用普通表，合并退化为只生成纪要 lastAiId=${lastAiId}`)
			await executeFill(session, { runMode: 'chronicle', messages, skipFloors: 0 })
			return
		}
		pushLog('info', 'fill', `after-send：合并填上一轮 lastAiId=${lastAiId}`)
		await executeFill(session, { runMode: 'merged', messages, skipFloors: 0 })
		return
	}
	if (tableActive) {
		pushLog('info', 'fill', `after-send：填上一轮表 lastAiId=${lastAiId}`)
		await executeFill(session, { runMode: 'table', messages, skipFloors: 0 })
		return
	}
	pushLog('info', 'fill', `after-send：生成上一轮纪要 lastAiId=${lastAiId}`)
	await executeFill(session, { runMode: 'chronicle', messages, skipFloors: 0 })
}

export async function runManualFill(session: CranialNerveSession, opts?: ExecuteFillOptions): Promise<RunResult> {
	return executeFill(session, opts)
}

export interface ManualCatchUpOptions {
	runMode?: FillRunMode
	fillCfgSource?: 'table' | 'chronicle'
	targetTables?: string[]
	fromAiFloor?: number
	toAiFloor?: number
	batchSize?: number
	extraHint?: string
	onProgress?: FillProgressFn
	suppressProgressNotifier?: boolean
	signal?: AbortSignal
}

function reasonsForSql(runMode: FillRunMode, sql: string, targetTables: string[]): SqlBatchOperation['reason'][] {
	if (runMode === 'chronicle') {
		return ['ai_fill_chronicle']
	}
	if (runMode === 'table') {
		return ['ai_fill_table']
	}
	const reasons: SqlBatchOperation['reason'][] = []
	if (sqlMentionsTable(sql, CHRONICLE_TABLE_NAME)) {
		reasons.push('ai_fill_chronicle')
	}
	if (targetTables.some((t) => sqlMentionsTable(sql, t))) {
		reasons.push('ai_fill_table')
	}
	return reasons
}

const FILL_PROGRESS_KEY = 'CN_FILL_PROGRESS'

interface FillProgress {
	tableFloor?: number
	chronicleFloor?: number
}

function readFillProgress(session: CranialNerveSession): FillProgress | null {
	const raw = session.chat.readChatMetadata(FILL_PROGRESS_KEY)
	if (!raw || typeof raw !== 'object') return null
	return raw as FillProgress
}

function updateFillProgress(session: CranialNerveSession, scene: 'table' | 'chronicle', floor: number): void {
	const current = readFillProgress(session)
	const key = scene === 'chronicle' ? 'chronicleFloor' : 'tableFloor'
	const prev = current?.[key]
	if (prev != null && floor <= prev) return
	session.chat.writeChatMetadata(FILL_PROGRESS_KEY, { ...(current ?? {}), [key]: floor })
}

export function detectLastSummarizedAiFloor(session: CranialNerveSession, scene: 'table' | 'chronicle' = 'table'): number | null {
	const progress = readFillProgress(session)
	const progressFloor = scene === 'chronicle' ? progress?.chronicleFloor : progress?.tableFloor
	if (progressFloor != null && progressFloor >= 0) return progressFloor
	const repo = session.getSyncBridgeRepo()
	if (!repo) return null
	const chat = session.chat.getChat()
	const targetReason = scene === 'chronicle' ? 'ai_fill_chronicle' : 'ai_fill_table'
	let lastSummarized: number | null = null
	for (let i = 0; i < chat.length; i++) {
		const msg = chat[i]
		if (!msg || msg.is_user || msg.is_system) continue
		const frame = repo.loadFrame(i)
		if (!frame) continue
		const hasAiFill = frame.logEntries.some((entry) =>
			entry.operations.some((op) => op.kind === 'sql_batch' && op.reason === targetReason)
		) || (frame.summarizedReasons ?? []).includes(targetReason)
		if (hasAiFill) lastSummarized = i
	}
	return lastSummarized
}

export function detectLastUpdatedAiFloorForTable(session: CranialNerveSession, tableName: string): number | null {
	const repo = session.getSyncBridgeRepo()
	if (!repo) return null
	const chat = session.chat.getChat()
	let lastUpdated: number | null = null
	for (let i = 0; i < chat.length; i++) {
		const msg = chat[i]
		if (!msg || msg.is_user || msg.is_system) continue
		const frame = repo.loadFrame(i)
		if (!frame) continue
		const hasUpdate = frame.logEntries.some((entry) =>
			entry.operations.some((op) =>
				op.kind === 'sql_batch' && op.reason === 'ai_fill_table' &&
				(op.statements ?? []).some((sql) => sqlMentionsTable(sql, tableName))
			)
		)
		if (hasUpdate) lastUpdated = i
	}
	return lastUpdated
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
	const toIdx = opts?.toAiFloor != null
		? opts.toAiFloor
		: aiFloors[aiFloors.length - 1]!
	if (opts?.runMode === 'merged') {
		const tableLast = detectLastSummarizedAiFloor(session, 'table')
		const chronicleLast = detectLastSummarizedAiFloor(session, 'chronicle')
		const tableFrom = opts?.fromAiFloor != null ? opts.fromAiFloor : (tableLast != null && tableLast >= 0 ? tableLast + 1 : 0)
		const chronicleFrom = opts?.fromAiFloor != null ? opts.fromAiFloor : (chronicleLast != null && chronicleLast >= 0 ? chronicleLast + 1 : 0)
		if (tableFrom > toIdx && chronicleFrom > toIdx) {
			return { ok: false, attempts: 0, error: '所选范围已追平，无需处理' }
		}
		if (tableFrom <= toIdx) {
			const tableSlice = chat.slice(tableFrom, toIdx + 1)
			const tableResult = await executeFill(session, {
				runMode: 'table',
				fillCfgSource: opts?.fillCfgSource,
				targetTables: opts?.targetTables,
				messages: tableSlice,
				batchSize: opts?.batchSize,
				extraHint: opts?.extraHint,
				onProgress: opts?.onProgress,
				suppressProgressNotifier: opts?.suppressProgressNotifier,
				signal: opts?.signal,
			})
			if (!tableResult.ok) return tableResult
		}
		if (chronicleFrom <= toIdx) {
			const chronicleSlice = chat.slice(chronicleFrom, toIdx + 1)
			const chronicleResult = await executeFill(session, {
				runMode: 'chronicle',
				fillCfgSource: 'chronicle',
				messages: chronicleSlice,
				batchSize: opts?.batchSize,
				extraHint: opts?.extraHint,
				onProgress: opts?.onProgress,
				suppressProgressNotifier: opts?.suppressProgressNotifier,
				signal: opts?.signal,
			})
			if (!chronicleResult.ok) return chronicleResult
		}
		return { ok: true, attempts: 0 }
	}
	const baseLastSummarized = detectLastSummarizedAiFloor(session, opts?.runMode === 'chronicle' ? 'chronicle' : 'table')
	const fromIdx = opts?.fromAiFloor != null
		? opts.fromAiFloor
		: (baseLastSummarized != null && baseLastSummarized >= 0
			? baseLastSummarized + 1
			: 0)
	if (fromIdx > toIdx) {
		return { ok: false, attempts: 0, error: '所选范围已追平，无需处理' }
	}
	const sliceMessages = chat.slice(fromIdx, toIdx + 1)
	return executeFill(session, {
		runMode: opts?.runMode,
		fillCfgSource: opts?.fillCfgSource,
		targetTables: opts?.targetTables,
		messages: sliceMessages,
		batchSize: opts?.batchSize,
		extraHint: opts?.extraHint,
		onProgress: opts?.onProgress,
		suppressProgressNotifier: opts?.suppressProgressNotifier,
		signal: opts?.signal,
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
