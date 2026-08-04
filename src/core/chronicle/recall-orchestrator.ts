import type { CranialNerveSession } from '../session'
import type { RecallContext } from '../chronicle'
import type { ProgressNotifier } from '@shared/types/config'
import { pushLog } from '@shared/log-buffer'
import { getPersonaDescription, getCharDescription, getUserName } from '@db/gateways/host-state'
import { RECALL_FIELD_PREFIX } from '@shared/constants'
import { serializeRecallPayload } from '@shared/recall-payload'

function isAbortError(e: unknown, signal?: AbortSignal): boolean {
	if (signal?.aborted) {
		return true
	}
	if (e instanceof DOMException && e.name === 'AbortError') {
		return true
	}
	return false
}

export async function onPromptReady(
	session: CranialNerveSession,
	targetUserIdx: number
): Promise<boolean> {
	const config = session.getConfig()
	if (!config.recallEnabled) {
		pushLog('warn', 'recall', 'recallEnabled=false，跳过召回')
		return true
	}
	const preset = session.getAiPresetForScene(config.recallPresetId)
	if (!preset) {
		pushLog('warn', 'recall', '无召回AI预设，跳过召回')
		return true
	}

	const recaller = session.getChronicleRecaller()
	if (!recaller) {
		pushLog('warn', 'recall', '无recaller，跳过召回')
		return true
	}

	const chat = session.chat.getChat()
	const lastUserIdx = targetUserIdx
	if (lastUserIdx < 0 || !chat[lastUserIdx]?.is_user) {
		pushLog('warn', 'recall', `消息索引无效 msgId=${targetUserIdx}，跳过召回`)
		return true
	}
	pushLog('info', 'recall', `开始召回 lastUserIdx=${lastUserIdx}`)

	const userMessage = chat[lastUserIdx]!.mes

	const userName = getUserName()
	const contextDepth = Math.max(1, config.recallContextDepth || 5)
	const contextMessages = chat.slice(Math.max(0, lastUserIdx - contextDepth), lastUserIdx)
	const conversationText = contextMessages
		.map((m) => `${m.is_user ? userName : 'Assistant'}: ${m.mes}`)
		.join('\n')

	const recallSegments = session.getActiveSegments('chronicleRecall')

	const starter = session.getProgressNotifier()
	const progress: ProgressNotifier | undefined = starter?.('正在召回数据...')

	const recallCtx: RecallContext = {
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
		recallSegments,
		userMessage,
		conversationText,
		personaDescription: getPersonaDescription(),
		charDescription: getCharDescription(),
		currentTime: new Date().toISOString(),
		vectorEnabled: config.vectorEnabled,
		vectorConfig: config.vector,
		chatToken: session.getChatToken(),
		recallRecentFixedInjectCount: config.recallRecentFixedInjectCount,
		recallMinScore: config.recallMinScore,
		signal: progress?.abortSignal,
		callOptions: {
			timeoutMs: config.pending.aiCallTimeoutMs,
			timeoutRetries: config.pending.aiTimeoutRetries
		}
	}

	try {
		const items = await session.getWriteQueue().enqueue(() => recaller.recall(recallCtx))
		pushLog('info', 'recall', `召回返回 items=${items.length}`)
		if (items.length === 0) {
			progress?.close()
			return true
		}
		const limited = items.slice(0, config.maxRecallItems)
		const keys = limited.map((it) => it.key).join(' ')
		chat[lastUserIdx]!.mes = `${keys}\n${userMessage}`
		session.chat.writeMessageExtra(lastUserIdx, RECALL_FIELD_PREFIX, serializeRecallPayload(limited))
		session.chat.writeMessageExtra(lastUserIdx, 'display_text', userMessage)
		pushLog('info', 'recall', `写入mes keys="${keys}" extra已写入`)
		session.renderRecallCard(lastUserIdx)
		void session.chat.saveChat()
		progress?.done()
		return true
	} catch (e) {
		if (isAbortError(e, progress?.abortSignal)) {
			progress?.fail('操作已终止')
			pushLog('info', 'recall', '召回被用户终止，发送原始消息')
			return false
		}
		progress?.fail(e instanceof Error ? e.message : String(e))
		pushLog('error', 'recall', `召回失败: ${e instanceof Error ? e.message : String(e)}`)
		return true
	}
}
