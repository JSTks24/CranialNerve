if (typeof (globalThis as unknown as { process?: unknown }).process === 'undefined') {
	;(globalThis as unknown as { process: Record<string, unknown> }).process = {
		env: { NODE_ENV: 'production' },
		platform: 'browser',
		version: '',
	}
}

import { init as uiInit } from './ui'
import { getSession } from '@core/session'
import { onGenerationEnded } from '@core/table/fill-orchestrator'
import { onPromptReady } from '@core/chronicle/recall-orchestrator'
import { registerCNRegexScripts } from '@core/regex-scripts'
import { getCNApi } from '@core/api/registry'
import { EVENT_GENERATION_ENDED, EVENT_CHAT_COMPLETION_PROMPT_READY } from '@shared/constants/events'

export async function init(): Promise<void> {
	await uiInit()
	const session = getSession()
	registerCNRegexScripts()
	;(window as unknown as Record<string, unknown>).CN_API = getCNApi()
	session.event.makeLast(EVENT_GENERATION_ENDED, () => {
		onGenerationEnded(session).catch(() => {})
	})
	session.event.makeLast(EVENT_CHAT_COMPLETION_PROMPT_READY, (...args: unknown[]) => {
		const eventData = args[0] as { chat: SillyTavernChatMessage[]; dryRun?: boolean }
		if (eventData) {
			onPromptReady(session, eventData).catch(() => {})
		}
	})
}
