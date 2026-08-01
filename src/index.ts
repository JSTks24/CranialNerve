if (typeof (globalThis as unknown as { process?: unknown }).process === 'undefined') {
	;(globalThis as unknown as { process: Record<string, unknown> }).process = {
		env: { NODE_ENV: 'production' },
		platform: 'browser',
		version: '',
	}
}

import { init as uiInit } from './ui'
import { getSession } from '@core/session'
import { removeCNRegexScripts } from '@core/regex-scripts'
import { getCNApi } from '@core/api/registry'
import { getHostContext } from '@db/gateways/host-context'
import { registerGenerateInterceptor } from '@core/chronicle/generate-interceptor'

export async function init(): Promise<void> {
	await uiInit()
	const session = getSession()
	const ctx = getHostContext()
	if (Array.isArray(ctx.extensionSettings.regex)) {
		ctx.extensionSettings.regex = removeCNRegexScripts(ctx.extensionSettings.regex as Record<string, unknown>[])
	}
	registerGenerateInterceptor()
	window.addEventListener('beforeunload', () => {
		try {
			session.worldbook.detachFromChatSync()
		} catch {}
		try {
			void session.chat.saveChat()
		} catch {}
		const hostCtx = ctx as unknown as Record<string, unknown>
		if (typeof hostCtx.saveSettings === 'function') {
			;(hostCtx as { saveSettings: () => void }).saveSettings()
		}
	})
	;(window as unknown as Record<string, unknown>).CN_API = getCNApi()
}
