<script setup lang="ts">
import { ref, onActivated } from 'vue'
import { getSession } from '@core/session'
import toast from '@ui/toast'
import { pushLog } from '@shared/log-buffer'

const session = getSession()
const tableCount = ref(0)
const chronicleCount = ref(0)
const activePresetName = ref('未配置')
const activePresetModel = ref('')
const chatActive = ref(false)

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

onActivated(refresh)
refresh()
</script>

<template>
	<div class="welcome-root">
		<div class="welcome-hero">
			<div class="welcome-hero__left">
				<h1 class="welcome-hero__title">CranialNerve</h1>
				<p class="welcome-hero__sub">新一代简约强大的类数据库综合工具，致力于提供更好的游玩体验</p>
			</div>
			<button class="welcome-hero__reset" @click="resetDefaults"><i class="fa-solid fa-rotate-left"></i>恢复默认设置</button>
		</div>

		<div class="cn-card welcome-panel">
			<div class="cn-card__head welcome-panel__head">
				<h3 class="welcome-panel__title">系统状态</h3>
			</div>
			<div class="cn-card__body welcome-panel__body">
				<div class="welcome-health-item welcome-health-item--ok">
					<div class="welcome-health-item__icon"><i class="fa-solid fa-table"></i></div>
					<div class="welcome-health-item__body">
						<strong>数据表</strong>
						<p>{{ chatActive ? `${tableCount} 张` : '未检测到聊天' }}</p>
					</div>
				</div>
				<div class="welcome-health-item welcome-health-item--ok">
					<div class="welcome-health-item__icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
					<div class="welcome-health-item__body">
						<strong>纪要条目</strong>
						<p>{{ chatActive ? `${chronicleCount} 条` : '未检测到聊天' }}</p>
					</div>
				</div>
				<div class="welcome-health-item" :class="activePresetName === '未配置' ? 'welcome-health-item--warn' : 'welcome-health-item--ok'">
					<div class="welcome-health-item__icon"><i class="fa-solid fa-plug"></i></div>
					<div class="welcome-health-item__body">
						<strong>AI 连接</strong>
						<p>{{ activePresetModel || activePresetName }}</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
