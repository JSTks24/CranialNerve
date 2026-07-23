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
import { registerCNRegexScripts, unregisterCNRegexScripts } from '@core/regex-scripts'
import { getCNApi } from '@core/api/registry'
import { getHostContext } from '@db/gateways/host-context'
import { EVENT_GENERATION_ENDED, EVENT_CHAT_COMPLETION_PROMPT_READY } from '@shared/constants/events'

export async function init(): Promise<void> {
	await uiInit()
	const session = getSession()
	const ctx = getHostContext()
	if (!Array.isArray(ctx.extensionSettings.regex)) {
		ctx.extensionSettings.regex = []
	}
	ctx.extensionSettings.regex = registerCNRegexScripts(ctx.extensionSettings.regex as Record<string, unknown>[])
	window.addEventListener('beforeunload', () => {
		ctx.extensionSettings.regex = unregisterCNRegexScripts(ctx.extensionSettings.regex as Record<string, unknown>[])
	})
	;(window as unknown as Record<string, unknown>).CN_API = getCNApi()
	session.event.makeLast(EVENT_GENERATION_ENDED, () => {
		onGenerationEnded(session).catch((e) => {
			console.error('[CranialNerve] onGenerationEnded error:', e instanceof Error ? e.message : e)
		})
	})
	session.event.makeLast(EVENT_CHAT_COMPLETION_PROMPT_READY, (...args: unknown[]) => {
		const eventData = args[0] as { chat: SillyTavernChatMessage[]; dryRun?: boolean }
		if (eventData) {
			onPromptReady(session, eventData).catch((e) => {
				console.error('[CranialNerve] onPromptReady error:', e instanceof Error ? e.message : e)
			})
		}
	})
}
