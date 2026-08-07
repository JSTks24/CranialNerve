import { defineStore } from 'pinia'
import { ref, computed, onBeforeUnmount, onMounted } from 'vue'
import { getAllLogs, clearLogs, subscribe, pushLog, isDebugMode, setDebugMode, LEVEL_ORDER } from '@shared/log-buffer'
import type { LogEntry, LogLevel } from '@shared/log-buffer'
import { getAllPromptTraces } from '@shared/prompt-trace'
import type { PromptTraceEntry } from '@shared/prompt-trace'
import { getSession } from '@core/session'
import { buildBookName } from '@core/worldbook-sync'
import { cleanupStaleBooks, syncToWorldbook } from '@core/worldbook-sync'
import { isFillInProgress } from '@core/table/fill-orchestrator'
import toast from '@ui/toast'

export type LogLevelFilter = LogLevel | 'all'

export type DebugPanel = 'logs' | 'status'

export const useDebugStore = defineStore('cn-debug', () => {
	const session = getSession()
	const logs = ref<LogEntry[]>([])
	const levelFilter = ref<LogLevelFilter>('warn')
	const tagFilter = ref('all')
	const keyword = ref('')
	const paused = ref(false)
	const autoScroll = ref(true)
	const chatActive = ref(false)
	const pendingEntries = ref<LogEntry[]>([])
	const debugMode = ref(false)
	const expandedTraceId = ref<number | null>(null)
	const activePanel = ref<DebugPanel>('logs')
	let unsubscribe: (() => void) | null = null

	const tagOptions = computed(() => {
		const tags = new Set(logs.value.map((l) => l.tag))
		return ['all', ...Array.from(tags)]
	})

	const filteredLogs = computed(() => {
		const needle = keyword.value.trim().toLowerCase()
		return logs.value.filter((entry) => {
			if (levelFilter.value !== 'all' && LEVEL_ORDER[entry.level] < LEVEL_ORDER[levelFilter.value as LogLevel]) return false
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

	const expandedTrace = computed<PromptTraceEntry | null>(() => {
		const traceId = expandedTraceId.value
		if (traceId == null) return null
		return getAllPromptTraces().find((t) => t.id === traceId) ?? null
	})

	const worldbookStatus = ref({ cnName: '', cnExists: false, staleCount: 0, totalBooks: 0 })
	const tableStatus = ref({ tableCount: 0, chronicleCount: 0 })
	const snapshotStatus = ref({ snapshotIndex: null as number | null, snapshotCount: 0, lastAiIndex: null as number | null, indices: [] as number[] })
	const configStatus = ref({ hasAI: false, recallEnabled: false, chronicleGenEnabled: false, autoFill: false, vectorEnabled: false })

	function recoverSnapshotAt(index: number): boolean {
		const ok = session.recoverSnapshotAt(index)
		refresh()
		if (ok) {
			pushLog('warn', 'debug', `已手动恢复到第 ${index + 1} 楼快照`)
		} else {
			pushLog('warn', 'debug', `恢复到第 ${index + 1} 楼快照失败`)
		}
		return ok
	}

	function refresh() {
		logs.value = getAllLogs()
		chatActive.value = session.isChatActive()
		const wb = session.worldbook
		const cnName = buildBookName(session.getChatToken())
		const all = wb.listWorldbookNames()
		worldbookStatus.value = {
			cnName,
			cnExists: all.includes(cnName),
			staleCount: all.filter((n) => n.startsWith('CN_Data_') && n !== cnName).length,
			totalBooks: all.length,
		}
		const tables = session.listTables()
		let chronicleCount = 0
		try {
			const chronicleRows = session.getTableRowsWithRowid('cn_chronicle')
			chronicleCount = chronicleRows[0]?.rows?.length ?? 0
		} catch {
			chronicleCount = 0
		}
		tableStatus.value = {
			tableCount: tables.filter((n) => n !== 'cn_chronicle').length,
			chronicleCount,
		}
		const diag = session.getLoadDiagnostic()
		snapshotStatus.value = {
			snapshotIndex: diag.snapshotIndex,
			snapshotCount: diag.snapshotCount,
			lastAiIndex: diag.lastAiIndex,
			indices: session.listSnapshotIndices(),
		}
		const cfg = session.getConfig()
		configStatus.value = {
			hasAI: cfg.aiPresets.length > 0 && !!cfg.activeAiPresetId,
			recallEnabled: cfg.recallEnabled,
			chronicleGenEnabled: cfg.chronicleFill.autoFillTrigger !== 'off',
			autoFill: cfg.tableFill.autoFillTrigger !== 'off',
			vectorEnabled: cfg.vectorEnabled,
		}
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

	async function resetChatData() {
		if (isFillInProgress()) {
			toast.warning('填表/纪要生成进行中，暂不能清空')
			return
		}
		try {
			await session.resetChatData()
			pushLog('warn', 'debug', '已彻底清空当前聊天数据')
			toast.info('已彻底清空当前聊天数据，CN 已重新初始化')
			refresh()
		} catch (e) {
			pushLog('error', 'debug', `彻底清空失败: ${e instanceof Error ? e.message : String(e)}`)
			toast.error(`彻底清空失败: ${e instanceof Error ? e.message : String(e)}`)
		}
	}

	function toggleDebugMode() {
		debugMode.value = !debugMode.value
		setDebugMode(debugMode.value)
		levelFilter.value = debugMode.value ? 'debug' : 'warn'
	}

	function toggleLogExpand(traceId: number) {
		expandedTraceId.value = expandedTraceId.value === traceId ? null : traceId
	}

	onMounted(() => {
		debugMode.value = isDebugMode()
		levelFilter.value = debugMode.value ? 'debug' : 'warn'
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
		debugMode,
		expandedTraceId,
		expandedTrace,
		activePanel,
		refresh,
		setPaused,
		clearAll,
		exportLogs,
		forceCleanupBooks,
		forceSyncBooks,
		resetChatData,
		toggleDebugMode,
		toggleLogExpand,
	}
})
