if (typeof (globalThis as unknown as { process?: unknown }).process === 'undefined') {
	;(globalThis as unknown as { process: Record<string, unknown> }).process = {
		env: { NODE_ENV: 'production' },
		platform: 'browser',
		version: '',
	}
}

import { init as uiInit } from './ui'
import { getSession } from '@core/session'
import { registerCNRegexScripts, unregisterCNRegexScripts } from '@core/regex-scripts'
import { getCNApi } from '@core/api/registry'
import { getHostContext } from '@db/gateways/host-context'

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
		try {
			session.worldbook.detachFromChat()
		} catch {}
		try {
			session.chat.saveChat()
		} catch {}
		const hostCtx = ctx as unknown as Record<string, unknown>
		if (typeof hostCtx.saveSettings === 'function') {
			;(hostCtx as { saveSettings: () => void }).saveSettings()
		}
	})
	;(window as unknown as Record<string, unknown>).CN_API = getCNApi()
}
