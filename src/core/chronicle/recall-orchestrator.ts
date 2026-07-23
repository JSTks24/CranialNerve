import type { CranialNerveSession } from '../session'
import type { RecallContext, RecallItem } from '../chronicle'

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function buildRecallCard(items: RecallItem[], userMessage: string): string {
	const uid = Date.now().toString(36)
	const countText = `${items.length} 条记忆`

	let tabsHtml = ''
	let keywords = ''

	for (let i = 0; i < items.length; i++) {
		const item = items[i]
		if (!item) {
			continue
		}
		const checked = i === 0 ? ' checked' : ''
		const rid = `r-${uid}-${i}`

		tabsHtml += `<input type="radio" name="r-${uid}" id="${rid}" class="cn-recall-tabs__radio"${checked}>`
		tabsHtml += `<label for="${rid}" class="cn-recall-tab">`
		tabsHtml += `<span class="cn-recall-tab__key">${escapeHtml(item.key)}</span>`
		tabsHtml += `<span class="cn-recall-tab__time">${escapeHtml(item.timeDeltaText)}</span>`
		tabsHtml += `<span class="cn-recall-tab__loc">${escapeHtml(item.entry.content.location ?? '')}</span>`
		tabsHtml += `</label>`

		const summary = item.entry.content.summary ?? ''
		const dialogue = item.entry.content.keyDialogue ?? ''
		const timeStart = item.entry.timeStart ?? ''
		const timeEnd = item.entry.timeEnd ?? ''
		const location = item.entry.content.location ?? ''

		tabsHtml += `<div class="cn-recall-panel">`
		tabsHtml += `<div class="cn-recall-panel__row"><span class="cn-recall-panel__label">时间范围</span><span class="cn-recall-panel__value">${escapeHtml(timeStart)} ~ ${escapeHtml(timeEnd)}</span></div>`
		tabsHtml += `<div class="cn-recall-panel__row"><span class="cn-recall-panel__label">地点</span><span class="cn-recall-panel__value">${escapeHtml(location)}</span></div>`
		tabsHtml += `<div class="cn-recall-panel__row cn-recall-panel__row--full"><span class="cn-recall-panel__label">纪要正文</span><span class="cn-recall-panel__value">${escapeHtml(summary)}</span></div>`
		tabsHtml += `<div class="cn-recall-panel__row cn-recall-panel__row--full"><span class="cn-recall-panel__label">重要台词</span><span class="cn-recall-panel__value">${escapeHtml(dialogue)}</span></div>`
		tabsHtml += `</div>`

		keywords += `${item.key} `
	}

	const card =
		`<div class="cn-recall-card">` +
		`<div class="cn-recall-card__head"><i class="fa-solid fa-brain cn-recall-card__icon"></i><span class="cn-recall-card__brand">CranialNerve</span><span class="cn-recall-card__count">${countText}</span></div>` +
		`<div class="cn-recall-tabs">${tabsHtml}</div>` +
		`<div class="cn-recall-card__message">${escapeHtml(userMessage)}</div>` +
		`</div>`

	const fullMessage =
		`[CN_recall_ui]\n${card}\n[/CN_recall_ui]\n${keywords.trim()}\n${userMessage}`

	return fullMessage
}

export async function onPromptReady(
	session: CranialNerveSession,
	eventData: { chat: SillyTavernChatMessage[]; dryRun?: boolean }
): Promise<void> {
	if (eventData.dryRun) {
		return
	}

	const config = session.getConfig()
	if (!config.recallEnabled) {
		return
	}
	const preset = session.getAiPresetForScene(config.recallPresetId)
	if (!preset) {
		return
	}

	const recaller = session.getChronicleRecaller()
	if (!recaller) {
		return
	}

	const chat = eventData.chat
	let lastUserIdx = -1
	for (let i = chat.length - 1; i >= 0; i--) {
		if (chat[i]?.is_user) {
			lastUserIdx = i
			break
		}
	}
	if (lastUserIdx < 0) {
		return
	}

	const userMessage = chat[lastUserIdx]!.mes

	const contextDepth = Math.max(1, config.recallContextDepth || 5)
	const contextMessages = chat.slice(Math.max(0, lastUserIdx - contextDepth), lastUserIdx)
	const conversationText = contextMessages
		.map((m) => `${m.is_user ? 'User' : 'Assistant'}: ${m.mes}`)
		.join('\n')

	const recallSegments = session.getActiveSegments('chronicleRecall')

	const recallCtx: RecallContext = {
		clientConfig: { baseURL: preset.baseURL, apiKey: preset.apiKey, customIncludeBody: preset.customIncludeBody, customExcludeBody: preset.customExcludeBody, customIncludeHeaders: preset.customIncludeHeaders },
		params: { model: preset.model },
		recallSegments,
		userMessage,
		conversationText,
		currentTime: new Date().toISOString(),
		vectorEnabled: config.vectorEnabled,
		vectorConfig: config.vector
	}

	const items = await session.getWriteQueue().enqueue(() => recaller.recall(recallCtx))

	if (items.length === 0) {
		return
	}

	const limited = items.slice(0, config.maxRecallItems)

	chat[lastUserIdx]!.mes = buildRecallCard(limited, userMessage)
}
