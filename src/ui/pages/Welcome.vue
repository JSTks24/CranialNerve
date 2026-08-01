<script setup lang="ts">
import { ref, computed, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { getSession } from '@core/session'
import { detectLastSummarizedAiFloor } from '@core/table/fill-orchestrator'
import toast from '@ui/toast'
import { pushLog } from '@shared/log-buffer'

const router = useRouter()
const session = getSession()
const tableCount = ref(0)
const chronicleCount = ref(0)
const activePresetName = ref('未配置')
const activePresetModel = ref('')
const chatActive = ref(false)
const vectorEnabled = ref(false)
const recallEnabled = ref(true)
const lastSummarized = ref<number | null>(null)
const snapshotCount = ref(0)
const snapshotIndex = ref<number | null>(null)

interface OnboardStep {
	name: string
	ok: boolean
	okDesc: string
	todoDesc: string
	actionPath?: string
	actionLabel?: string
}

const aiFloorCount = computed(() => session.chat.getChat().filter((m) => !m.is_user && !m.is_system).length)
const summarizedAiCount = computed(() => {
	const last = lastSummarized.value
	if (last == null) return 0
	return session.chat.getChat().slice(0, last + 1).filter((m) => !m.is_user && !m.is_system).length
})
const unrecordedCount = computed(() => Math.max(0, aiFloorCount.value - summarizedAiCount.value))

const steps = computed<OnboardStep[]>(() => [
	{
		name: '配置 AI 预设',
		ok: activePresetName.value !== '未配置',
		okDesc: `当前使用：${activePresetName.value}${activePresetModel.value ? ' · ' + activePresetModel.value : ''}`,
		todoDesc: '到 API 配置页新建一组 AI 预设',
		actionPath: activePresetName.value === '未配置' ? '/api' : undefined,
		actionLabel: '去配置'
	},
	{
		name: '打开一个对话',
		ok: chatActive.value,
		okDesc: '对话已载入，数据自动按聊天隔离',
		todoDesc: '在酒馆中打开一个含 CN 模板的对话'
	},
	{
		name: '生成数据表',
		ok: chatActive.value && tableCount.value > 0,
		okDesc: `${tableCount.value} 张数据表运行中`,
		todoDesc: '进入对话后按角色卡模板自动建表'
	},
	{
		name: '写下首条纪要',
		ok: chatActive.value && chronicleCount.value > 0,
		okDesc: `${chronicleCount.value} 条纪要在库`,
		todoDesc: '发一条消息，纪要生成后将自动归档'
	}
])

const readyCount = computed(() => steps.value.filter((s) => s.ok).length)

function refresh() {
	chatActive.value = session.isChatActive()
	tableCount.value = session.listTables().filter((n) => n !== 'cn_chronicle').length
	try {
		const cr = session.getTableRowsWithRowid('cn_chronicle')
		chronicleCount.value = cr[0]?.rows?.length ?? 0
	} catch {
		chronicleCount.value = 0
	}
	const preset = session.getActiveAiPreset()
	activePresetName.value = preset?.name ?? '未配置'
	activePresetModel.value = preset?.model ?? ''
	vectorEnabled.value = session.getConfig().vectorEnabled
	recallEnabled.value = session.getConfig().recallEnabled
	try {
		lastSummarized.value = chatActive.value ? detectLastSummarizedAiFloor(session) : null
	} catch {
		lastSummarized.value = null
	}
	const diag = session.getLoadDiagnostic()
	snapshotCount.value = diag.snapshotCount
	snapshotIndex.value = diag.snapshotIndex ?? null
	checkSnapshotRollback()
}

function checkSnapshotRollback() {
	const diag = session.getLoadDiagnostic()
	if (diag.snapshotCount === 0) return
	if (diag.snapshotIndex == null && diag.lastAiIndex != null) {
		pushLog('warn', 'snapshot', '未找到数据库快照，表数据可能已随删除消息丢失')
		return
	}
	if (diag.snapshotIndex != null && diag.lastAiIndex != null && diag.snapshotIndex < diag.lastAiIndex) {
		pushLog('warn', 'snapshot', `数据库已回退到第 ${diag.snapshotIndex + 1} 楼的快照（最近 AI 消息在第 ${diag.lastAiIndex + 1} 楼），期间填表数据可能丢失`)
	}
}

function resetDefaults() {
	const c = session.getConfig()
	c.tableFill.autoFill = true
	c.tableFill.contextDepth = 3
	c.tableFill.updateFrequency = 1
	c.tableFill.batchSize = 3
	c.tableFill.skipFloors = 0
	c.tableFill.maxRetries = 3
	c.tableFill.manualUpdateContextDepth = null
	c.tableFill.manualUpdateBatchSize = null
	c.tableFill.manualSelectedTables = []
	c.tableFill.hasManualSelection = false
	c.recallEnabled = true
	c.chronicleGenEnabled = true
	c.maxRecallItems = 25
	c.recallContextDepth = 5
	c.snapshotStrategy = 'every-message'
	c.retainFloors = 100
	c.tableFillPresetId = ''
	c.recallPresetId = ''
	c.prompt = session.getConfig().prompt
	c.vector = { embeddingEndpoint: '', embeddingApiKey: '', embeddingModel: '', rerankEndpoint: '', rerankApiKey: '', rerankModel: '' }
	c.vectorEnabled = false
	session.saveConfig(c)
	toast.success('已恢复默认设置')
	refresh()
}

function onExportSnapshot() {
	try {
		const file = session.exportSnapshot()
		const data = JSON.stringify(file, null, 2)
		const blob = new Blob([data], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `cn-snapshot-${Date.now()}.json`
		a.click()
		URL.revokeObjectURL(url)
		toast.success('快照已导出')
	} catch (e) {
		toast.error(e instanceof Error ? e.message : String(e))
	}
}

function go(path: string) {
	router.push(path)
}

onActivated(refresh)
refresh()
</script>

<template>
	<div class="welcome-root">
		<section class="welcome-hero">
			<div class="welcome-hero__left">
				<h1 class="welcome-hero__title">CranialNerve</h1>
				<p class="welcome-hero__sub">新一代简约强大的类数据库综合工具，致力于提供更好的游玩体验</p>
			</div>
			<div class="welcome-hero__actions">
				<button class="cn-btn" :disabled="!chatActive" @click="onExportSnapshot">
					<i class="fa-solid fa-download"></i>导出快照
				</button>
				<button class="cn-btn cn-btn--soft" @click="resetDefaults">
					<i class="fa-solid fa-rotate-left"></i>恢复默认设置
				</button>
			</div>
		</section>

		<section class="welcome-stats">
			<div class="welcome-stat">
				<div class="welcome-stat__icon"><i class="fa-solid fa-table"></i></div>
				<div class="welcome-stat__num">{{ chatActive ? tableCount : '—' }}</div>
				<div class="welcome-stat__label">数据表</div>
			</div>
			<div class="welcome-stat">
				<div class="welcome-stat__icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
				<div class="welcome-stat__num">{{ chatActive ? chronicleCount : '—' }}</div>
				<div class="welcome-stat__label">纪要条目</div>
			</div>
			<div class="welcome-stat">
				<div class="welcome-stat__icon"><i class="fa-solid fa-plug"></i></div>
				<div class="welcome-stat__num welcome-stat__num--text">{{ activePresetModel || activePresetName }}</div>
				<div class="welcome-stat__label">AI 连接</div>
			</div>
		</section>

		<div class="welcome-panels">
			<section class="cn-card">
				<div class="cn-card__head">
					<span>新手上路</span>
					<span class="welcome-badge">{{ readyCount }}/4 已就绪</span>
				</div>
				<div>
					<div
						v-for="(step, i) in steps"
						:key="step.name"
						class="welcome-step"
						:class="{ 'welcome-step--ok': step.ok }"
					>
						<div class="welcome-step__bead">
							<i v-if="step.ok" class="fa-solid fa-check"></i>
							<span v-else>{{ i + 1 }}</span>
						</div>
						<div class="welcome-step__body">
							<span class="welcome-step__name">{{ step.name }}</span>
							<span class="welcome-step__desc">{{ step.ok ? step.okDesc : step.todoDesc }}</span>
						</div>
						<button v-if="step.actionPath" class="cn-btn cn-btn--sm cn-btn--soft" @click="go(step.actionPath)">
							{{ step.actionLabel }}
						</button>
						<span v-else class="welcome-step__status">{{ step.ok ? '已就绪' : '未完成' }}</span>
					</div>
				</div>
			</section>

			<section class="cn-card">
				<div class="cn-card__head"><span>运行状态</span></div>
				<div>
					<div
						class="welcome-health-item"
						:class="chatActive ? (unrecordedCount > 0 ? 'welcome-health-item--warn' : 'welcome-health-item--ok') : ''"
					>
						<div class="welcome-health-item__icon"><i class="fa-solid fa-layer-group"></i></div>
						<div class="welcome-health-item__body">
							<strong>待总结楼层</strong>
							<p v-if="chatActive">{{ unrecordedCount > 0 ? `${unrecordedCount} 层待总结，追平后表格与纪要即同步` : '全部已同步' }}</p>
							<p v-else>未检测到聊天</p>
						</div>
						<button v-if="chatActive && unrecordedCount > 0" class="cn-btn cn-btn--sm" @click="go('/tables')">
							去追平
						</button>
					</div>
					<div
						class="welcome-health-item"
						:class="chatActive ? (snapshotCount > 0 ? 'welcome-health-item--ok' : 'welcome-health-item--warn') : ''"
					>
						<div class="welcome-health-item__icon"><i class="fa-solid fa-database"></i></div>
						<div class="welcome-health-item__body">
							<strong>数据库快照</strong>
							<p v-if="chatActive">{{ snapshotCount > 0 ? `已写入 ${snapshotCount} 个快照${snapshotIndex != null ? `，最近在第 ${snapshotIndex + 1} 楼` : ''}` : '尚无快照，进入对话后自动创建' }}</p>
							<p v-else>未检测到聊天</p>
						</div>
					</div>
					<div class="welcome-health-item" :class="recallEnabled ? 'welcome-health-item--ok' : ''">
						<div class="welcome-health-item__icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
						<div class="welcome-health-item__body">
							<strong>纪要召回</strong>
							<p>{{ recallEnabled ? '已开启，发消息时自动召回相关纪要' : '已关闭，召回管线停用' }}</p>
						</div>
					</div>
				</div>
			</section>
		</div>
	</div>
</template>
