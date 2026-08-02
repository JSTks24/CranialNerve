import { defineStore } from 'pinia'
import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
import { getAllLogs, clearLogs, subscribe, pushLog } from '@shared/log-buffer'
import type { LogEntry, LogLevel } from '@shared/log-buffer'
import { getSession } from '@core/session'
import { buildBookName } from '@core/worldbook-sync'
import { cleanupStaleBooks, syncToWorldbook } from '@core/worldbook-sync'

export type LogLevelFilter = LogLevel | 'all'

export const useDebugStore = defineStore('cn-debug', () => {
	const session = getSession()
	const logs = ref<LogEntry[]>([])
	const levelFilter = ref<LogLevelFilter>('all')
	const tagFilter = ref('all')
	const keyword = ref('')
	const paused = ref(false)
	const autoScroll = ref(true)
	const chatActive = ref(false)
	const pendingEntries = ref<LogEntry[]>([])
	let unsubscribe: (() => void) | null = null

	const tagOptions = computed(() => {
		const tags = new Set(logs.value.map((l) => l.tag))
		return ['all', ...Array.from(tags)]
	})

	const filteredLogs = computed(() => {
		const needle = keyword.value.trim().toLowerCase()
		return logs.value.filter((entry) => {
			if (levelFilter.value !== 'all' && entry.level !== levelFilter.value) return false
			if (tagFilter.value !== 'all' && entry.tag !== tagFilter.value) return false
			if (needle && !entry.message.toLowerCase().includes(needle)) return false
			return true
		})
	})

	const visibleLogs = computed(() => filteredLogs.value.slice().reverse())
	const filteredCount = computed(() => filteredLogs.value.length)
	const totalCount = computed(() => logs.value.length)
	const pendingCount = computed(() => pendingEntries.value.length)
	const statusLabel = computed(() => {
		if (paused.value) return pendingCount.value ? `已暂停，${pendingCount.value} 条待显示` : '已暂停'
		return '实时更新中'
	})

	const worldbookStatus = computed(() => {
		const wb = session.worldbook
		const cnName = buildBookName(session.getChatToken())
		const all = wb.listWorldbookNames()
		const cnExists = all.includes(cnName)
		const staleCount = all.filter((n) => n.startsWith('CN_Data_') && n !== cnName).length
		return { cnName, cnExists, staleCount, totalBooks: all.length }
	})

	const tableStatus = computed(() => {
		const tables = session.listTables()
		let chronicleCount = 0
		try {
			const chronicleRows = session.getTableRowsWithRowid('cn_chronicle')
			chronicleCount = chronicleRows[0]?.rows?.length ?? 0
		} catch {
			chronicleCount = 0
		}
		return {
			tableCount: tables.filter((n) => n !== 'cn_chronicle').length,
			chronicleCount,
		}
	})

	const snapshotStatus = computed(() => {
		const diag = session.getLoadDiagnostic()
		return {
			snapshotIndex: diag.snapshotIndex,
			snapshotCount: diag.snapshotCount,
			lastAiIndex: diag.lastAiIndex,
			indices: session.listSnapshotIndices(),
		}
	})

	function recoverSnapshotAt(index: number): boolean {
		const ok = session.recoverSnapshotAt(index)
		if (ok) {
			pushLog('warn', 'debug', `已手动恢复到第 ${index + 1} 楼快照`)
		} else {
			pushLog('warn', 'debug', `恢复到第 ${index + 1} 楼快照失败`)
		}
		return ok
	}

	const configStatus = computed(() => {
		const cfg = session.getConfig()
		return {
			hasAI: cfg.aiPresets.length > 0 && !!cfg.activeAiPresetId,
			recallEnabled: cfg.recallEnabled,
			chronicleGenEnabled: cfg.chronicleGenEnabled,
			autoFill: cfg.tableFill.autoFill,
			vectorEnabled: cfg.vectorEnabled,
		}
	})

	function refresh() {
		logs.value = getAllLogs()
		chatActive.value = session.isChatActive()
	}

	function setPaused(value: boolean) {
		paused.value = value
		if (!value) {
			pendingEntries.value = []
			refresh()
		}
	}

	function clearAll() {
		clearLogs()
		pendingEntries.value = []
		refresh()
	}

	function exportLogs() {
		const data = filteredLogs.value.map((e) => ({
			time: new Date(e.timestamp).toISOString(),
			level: e.level,
			tag: e.tag,
			message: e.message,
		}))
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `cn-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
		a.click()
		URL.revokeObjectURL(url)
	}

	async function forceCleanupBooks() {
		try {
			await session.runWrite(() => cleanupStaleBooks(session))
			pushLog('warn', 'debug', '已执行强制清理世界书')
		} catch (e) {
			pushLog('error', 'debug', `强制清理失败: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	async function forceSyncBooks() {
		try {
			await session.runWrite(() => syncToWorldbook(session))
			pushLog('warn', 'debug', '已执行强制同步世界书')
		} catch (e) {
			pushLog('error', 'debug', `强制同步失败: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	onMounted(() => {
		refresh()
		unsubscribe = subscribe((entry) => {
			if (paused.value) {
				pendingEntries.value = [...pendingEntries.value, entry]
				return
			}
			refresh()
		})
	})

	onBeforeUnmount(() => {
		unsubscribe?.()
		unsubscribe = null
	})

	return {
		logs,
		chatActive,
		visibleLogs,
		levelFilter,
		tagFilter,
		tagOptions,
		keyword,
		paused,
		autoScroll,
		filteredCount,
		totalCount,
		pendingCount,
		statusLabel,
		worldbookStatus,
		tableStatus,
		snapshotStatus,
		recoverSnapshotAt,
		configStatus,
		refresh,
		setPaused,
		clearAll,
		exportLogs,
		forceCleanupBooks,
		forceSyncBooks,
	}
})
