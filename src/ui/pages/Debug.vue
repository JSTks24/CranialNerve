<script setup lang="ts">
import { computed, ref, watch, nextTick, onActivated } from 'vue'
import { useDebugStore } from '@ui/stores/debug'
import CNTabs from '@ui/components/CNTabs.vue'
import { MAX_TRACES } from '@shared/prompt-trace'
import type { PromptTraceEntry } from '@shared/prompt-trace'
import confirm from '@ui/dialog'

const store = useDebugStore()
const logListEl = ref<HTMLElement | null>(null)

watch(() => store.visibleLogs.length, async () => {
	if (!store.autoScroll) return
	await nextTick()
	const el = logListEl.value
	if (el) el.scrollTop = el.scrollHeight
})

const debugTabs = computed(() => [
	{ key: 'logs', label: '运行日志', icon: 'fa-list', badge: store.filteredCount || undefined },
	{ key: 'status', label: '运行状态', icon: 'fa-circle-info' }
])
const activePanelValue = computed({
	get: () => store.activePanel,
	set: (v: string) => {
		store.activePanel = v as 'logs' | 'status'
	}
})

function formatTime(ts: number): string {
	const d = new Date(ts)
	const h = String(d.getHours()).padStart(2, '0')
	const m = String(d.getMinutes()).padStart(2, '0')
	const s = String(d.getSeconds()).padStart(2, '0')
	const ms = String(d.getMilliseconds()).padStart(3, '0')
	return `${h}:${m}:${s}.${ms}`
}

function recoverSnapshot() {
	const pick = document.getElementById('cn_snapshot_pick') as HTMLSelectElement | null
	if (!pick) return
	const idx = Number.parseInt(pick.value, 10)
	if (!Number.isFinite(idx)) return
	store.recoverSnapshotAt(idx)
}

async function resetChatData() {
	const ok = await confirm(
		'彻底清空当前聊天数据',
		'将永久删除本聊天的全部 CN 数据：绑定模板、快照帧与旧格式残留、召回数据、世界书、纪要向量索引与填充进度，聊天将以全新状态重新开始，此操作不可恢复。',
		'彻底清空',
		true
	)
	if (!ok) return
	await store.resetChatData()
}

async function copyText(text: string) {
	try {
		await navigator.clipboard.writeText(text)
	} catch {}
}

function copyTraceAll(t: PromptTraceEntry) {
	void copyText(JSON.stringify(t.segments, null, 2))
}

function copySegment(content: string) {
	void copyText(content)
}

onActivated(() => {
	store.refresh()
})
</script>

<template>
	<div class="debug-page">
		<CNTabs level="l2" :items="debugTabs" v-model="activePanelValue" />

		<div v-if="store.activePanel === 'logs'" class="debug-panel">
			<div class="debug-toolbar">
				<select class="cn-select debug-toolbar__select" v-model="store.levelFilter">
					<option value="debug">调试（全部）</option>
					<option value="info">信息+</option>
					<option value="warn">警告+</option>
					<option value="error">错误</option>
				</select>
				<select class="cn-select debug-toolbar__select" v-model="store.tagFilter">
					<option v-for="t in store.tagOptions" :key="t" :value="t">{{ t === 'all' ? '全部模块' : t }}</option>
				</select>
				<input class="cn-input debug-toolbar__search" v-model="store.keyword" placeholder="搜索关键词…" />
				<button class="cn-btn cn-btn--sm" @click="store.setPaused(!store.paused)">
					<i class="fa-solid" :class="store.paused ? 'fa-play' : 'fa-pause'"></i>
					{{ store.paused ? '恢复' : '暂停' }}
				</button>
				<button class="cn-btn cn-btn--sm" @click="store.autoScroll = !store.autoScroll">
					<i class="fa-solid" :class="store.autoScroll ? 'fa-arrow-down' : 'fa-ban'"></i>
				</button>
				<button class="cn-btn cn-btn--sm" @click="store.exportLogs">
					<i class="fa-solid fa-download"></i>
					导出
				</button>
				<button class="cn-btn cn-btn--sm cn-btn--text" @click="store.clearAll">
					<i class="fa-solid fa-trash"></i>
					清空
				</button>
				<label class="cn-switch debug-toolbar__debug">
					<input type="checkbox" class="cn-switch__input" :checked="store.debugMode" @change="store.toggleDebugMode" />
					<span class="cn-switch__track">
						<span class="cn-switch__knob"></span>
					</span>
					<span class="cn-switch__text">
						调试模式
					</span>
				</label>
			</div>

			<div class="debug-toolbar__hint">
				<span>{{ store.statusLabel }}</span>
				<span>最近 {{ store.totalCount }} 条，显示 {{ store.filteredCount }} 条</span>
				<span v-if="store.pendingCount">暂停期间新增 {{ store.pendingCount }} 条</span>
			</div>

			<div class="debug-log-list" ref="logListEl">
				<div v-if="store.visibleLogs.length === 0" class="cn-empty">暂无日志</div>
				<div
					v-for="log in store.visibleLogs"
					:key="log.id"
					class="debug-log-row"
					:class="[
						`debug-log-row--${log.level}`,
						{ 'debug-log-row--clickable': log.traceId, 'debug-log-row--expanded': log.traceId && store.expandedTraceId === log.traceId }
					]"
					@click="log.traceId && store.toggleLogExpand(log.traceId)"
				>
					<span class="debug-log-row__time">{{ formatTime(log.timestamp) }}</span>
					<span class="debug-log-row__level" :class="`debug-log-row__level--${log.level}`">{{ log.level === 'error' ? 'ERROR' : log.level === 'warn' ? 'WARN' : log.level === 'info' ? 'INFO' : 'DEBUG' }}</span>
					<span class="debug-log-row__tag">{{ log.tag }}</span>
					<span class="debug-log-row__msg">{{ log.message }}</span>
					<button
						v-if="log.traceId"
						class="cn-btn cn-btn--sm cn-btn--text debug-log-row__trace"
						@click.stop="log.traceId && store.toggleLogExpand(log.traceId)"
					>
						<i class="fa-solid" :class="store.expandedTraceId === log.traceId ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
					</button>
					<div v-if="log.traceId && store.expandedTraceId === log.traceId" class="debug-log-expand">
						<template v-if="store.expandedTrace">
							<div class="debug-log-expand__head">
								<span>{{ store.expandedTrace.scene }} · {{ store.expandedTrace.model }}</span>
								<span>{{ store.expandedTrace.segmentCount }} 段</span>
								<button class="cn-btn cn-btn--sm cn-btn--text" @click.stop="copyTraceAll(store.expandedTrace)">
									<i class="fa-solid fa-copy"></i>
									复制全部
								</button>
							</div>
							<div
								v-for="(seg, i) in store.expandedTrace.segments"
								:key="i"
								class="debug-trace-seg"
								:class="`debug-trace-seg--${seg.role}`"
							>
								<div class="debug-trace-seg__head">
									<span class="debug-trace-seg__role">{{ seg.role }}</span>
									<span class="debug-trace-seg__len">{{ seg.content.length }}字</span>
									<button class="cn-btn cn-btn--sm cn-btn--text" @click.stop="copySegment(seg.content)">
										<i class="fa-solid fa-copy"></i>
									</button>
								</div>
								<pre class="debug-trace-seg__pre">{{ seg.content }}</pre>
							</div>
							<div v-if="store.expandedTrace.response != null" class="debug-trace-seg debug-trace-seg--assistant">
								<div class="debug-trace-seg__head">
									<span class="debug-trace-seg__role">回复</span>
									<span class="debug-trace-seg__len">{{ store.expandedTrace.response.length }}字</span>
									<button class="cn-btn cn-btn--sm cn-btn--text" @click.stop="copySegment(store.expandedTrace.response!)">
										<i class="fa-solid fa-copy"></i>
									</button>
								</div>
								<pre class="debug-trace-seg__pre">{{ store.expandedTrace.response }}</pre>
							</div>
						</template>
						<div v-else class="debug-log-expand__empty">该提示词已超出保留范围（最近 {{ MAX_TRACES }} 条），无法查看</div>
					</div>
				</div>
			</div>
		</div>

		<div v-if="store.activePanel === 'status'" class="debug-panel">
			<div class="debug-status-grid">
				<div class="cn-card">
					<div class="cn-card__head">世界书</div>
					<div class="cn-card__body">
						<div class="debug-status-item">
							<span class="debug-status-item__label">当前世界书</span>
							<span class="debug-status-item__value">{{ store.worldbookStatus.cnName }}</span>
						</div>
						<div class="debug-status-item">
							<span class="debug-status-item__label">是否存在</span>
							<span class="debug-status-item__value" :class="store.worldbookStatus.cnExists ? 'debug-ok' : 'debug-err'">
								{{ store.worldbookStatus.cnExists ? '是' : '否' }}
							</span>
						</div>
						<div class="debug-status-item">
							<span class="debug-status-item__label">残留旧书</span>
							<span class="debug-status-item__value" :class="store.worldbookStatus.staleCount > 0 ? 'debug-err' : 'debug-ok'">
								{{ store.worldbookStatus.staleCount }} 本
							</span>
						</div>
						<div class="debug-status-item">
							<span class="debug-status-item__label">世界书总数</span>
							<span class="debug-status-item__value">{{ store.worldbookStatus.totalBooks }}</span>
						</div>
						<div class="debug-status-actions">
							<button class="cn-btn cn-btn--sm" @click="store.forceCleanupBooks">
								<i class="fa-solid fa-broom"></i>
								强制清理
							</button>
							<button class="cn-btn cn-btn--sm" @click="store.forceSyncBooks">
								<i class="fa-solid fa-rotate"></i>
								强制同步
							</button>
						</div>
					</div>
				</div>

				<div class="cn-card">
					<div class="cn-card__head">数据库</div>
					<div class="cn-card__body">
						<template v-if="store.chatActive">
							<div class="debug-status-item">
								<span class="debug-status-item__label">数据表数</span>
								<span class="debug-status-item__value">{{ store.tableStatus.tableCount }}</span>
							</div>
							<div class="debug-status-item">
								<span class="debug-status-item__label">纪要条数</span>
								<span class="debug-status-item__value">{{ store.tableStatus.chronicleCount }}</span>
							</div>
						</template>
						<div v-else class="debug-status-empty">未载入聊天</div>
					</div>
				</div>

				<div class="cn-card">
					<div class="cn-card__head">快照</div>
					<div class="cn-card__body">
						<template v-if="store.chatActive">
							<div class="debug-status-item">
								<span class="debug-status-item__label">可用快照数</span>
								<span class="debug-status-item__value">{{ store.snapshotStatus.snapshotCount }}</span>
							</div>
							<div class="debug-status-item">
								<span class="debug-status-item__label">当前快照位置</span>
								<span class="debug-status-item__value">
									{{ store.snapshotStatus.snapshotIndex != null ? `第 ${store.snapshotStatus.snapshotIndex + 1} 楼` : '无' }}
								</span>
							</div>
							<div class="debug-status-item">
								<span class="debug-status-item__label">最近 AI 楼</span>
								<span class="debug-status-item__value">
									{{ store.snapshotStatus.lastAiIndex != null ? `第 ${store.snapshotStatus.lastAiIndex + 1} 楼` : '无' }}
								</span>
							</div>
							<div class="debug-status-actions">
								<select class="cn-select" id="cn_snapshot_pick" :value="store.snapshotStatus.snapshotIndex ?? ''">
									<option v-for="idx in store.snapshotStatus.indices" :key="idx" :value="idx">第 {{ idx + 1 }} 楼</option>
								</select>
								<button class="cn-btn" @click="recoverSnapshot">
									<i class="fa-solid fa-clock-rotate-left"></i>
									恢复到此快照
								</button>
								<button class="cn-btn cn-btn--danger" @click="resetChatData">
									<i class="fa-solid fa-broom"></i>
									彻底清空
								</button>
							</div>
						</template>
						<div v-else class="debug-status-empty">未载入聊天</div>
					</div>
				</div>

				<div class="cn-card">
					<div class="cn-card__head">功能状态</div>
					<div class="cn-card__body">
						<div class="debug-status-item">
							<span class="debug-status-item__label">AI 已配置</span>
							<span class="debug-status-item__value" :class="store.configStatus.hasAI ? 'debug-ok' : 'debug-err'">
								{{ store.configStatus.hasAI ? '是' : '否' }}
							</span>
						</div>
						<div class="debug-status-item">
							<span class="debug-status-item__label">自动填表</span>
							<span class="debug-status-item__value" :class="store.configStatus.autoFill ? 'debug-ok' : ''">
								{{ store.configStatus.autoFill ? '开' : '关' }}
							</span>
						</div>
						<div class="debug-status-item">
							<span class="debug-status-item__label">纪要召回</span>
							<span class="debug-status-item__value" :class="store.configStatus.recallEnabled ? 'debug-ok' : ''">
								{{ store.configStatus.recallEnabled ? '开' : '关' }}
							</span>
						</div>
						<div class="debug-status-item">
							<span class="debug-status-item__label">纪要生成</span>
							<span class="debug-status-item__value" :class="store.configStatus.chronicleGenEnabled ? 'debug-ok' : ''">
								{{ store.configStatus.chronicleGenEnabled ? '开' : '关' }}
							</span>
						</div>
						<div class="debug-status-item">
							<span class="debug-status-item__label">向量检索</span>
							<span class="debug-status-item__value" :class="store.configStatus.vectorEnabled ? 'debug-ok' : ''">
								{{ store.configStatus.vectorEnabled ? '开' : '关' }}
							</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
