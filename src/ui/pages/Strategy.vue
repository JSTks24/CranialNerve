<script setup lang="ts">
import { ref, computed, onActivated } from 'vue'
import { getSession } from '@core/session'
import type { CranialNerveConfig } from '@shared/types/config'
import toast from '@ui/toast'
import CNTabs from '@ui/components/CNTabs.vue'

const session = getSession()
const cfg = ref<CranialNerveConfig>(session.getConfig())

type StrategyTab = 'fill' | 'recall' | 'snapshot' | 'ai'

const activeTab = ref<StrategyTab>('fill')
const activeTabValue = computed({
	get: () => activeTab.value,
	set: (v: string) => {
		activeTab.value = v as StrategyTab
	}
})
const snapshotTabs = [
	{ key: 'every-message', label: '每条消息（推荐）' },
	{ key: 'latest-only', label: '仅最新' }
]
const snapshotValue = computed({
	get: () => cfg.value.snapshotStrategy,
	set: (v: string) => {
		cfg.value.snapshotStrategy = v as typeof cfg.value.snapshotStrategy
		saveCfg()
	}
})

const tabs: { key: StrategyTab; label: string; icon: string }[] = [
	{ key: 'fill', label: '填表管线', icon: 'fa-diagram-project' },
	{ key: 'recall', label: '纪要召回', icon: 'fa-clock-rotate-left' },
	{ key: 'snapshot', label: '快照存储', icon: 'fa-database' },
	{ key: 'ai', label: 'AI 调用', icon: 'fa-plug' }
]

function clampInt(raw: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(raw) || Number.isNaN(raw)) return fallback
	return Math.max(min, Math.min(max, Math.trunc(raw)))
}

function saveCfg() {
	session.saveConfig(cfg.value)
}

function saveField(field: 'aiCallTimeoutMs' | 'aiTimeoutRetries' | 'listModelsTimeoutMs' | 'writeQueueDrainTimeoutMs' | 'minSummaryLength', min: number, max: number, fallback: number) {
	cfg.value.pending[field] = clampInt(cfg.value.pending[field] as number, min, max, fallback)
	session.saveConfig(cfg.value)
	toast.success('已保存')
}

function saveBoolean(field: 'summarizeOnManualAbort') {
	session.saveConfig(cfg.value)
	toast.success('已保存')
}

function onAutoFillChange(v: boolean) {
	if (!v) {
		cfg.value.tableFill.updateFrequency = 0
	} else if (cfg.value.tableFill.updateFrequency <= 0) {
		cfg.value.tableFill.updateFrequency = 1
	}
	saveCfg()
}

function onRecallChange(v: boolean) {
	if (v && !cfg.value.chronicleGenEnabled) {
		cfg.value.chronicleGenEnabled = true
	}
	saveCfg()
}

function onChronicleGenChange(v: boolean) {
	if (!v) {
		cfg.value.recallEnabled = false
	}
	saveCfg()
}

function onUpdateFreqChange(raw: unknown) {
	const n = clampInt(typeof raw === 'number' ? raw : 1, 0, 20, 1)
	cfg.value.tableFill.updateFrequency = n
	cfg.value.tableFill.autoFill = n > 0
	saveCfg()
}

const presetList = computed(() => session.getConfig().aiPresets)

function presetHint(pid: string): string {
	if (!pid) return presetList.value.length > 0 ? '跟随全局' : '(无可用预设)'
	const p = presetList.value.find((x) => x.id === pid)
	return p ? p.name : '(已失效)'
}

function saveTableField(field: 'contextDepth' | 'updateFrequency' | 'batchSize' | 'skipFloors' | 'maxRetries', min: number, max: number, fallback: number) {
	cfg.value.tableFill[field] = clampInt(cfg.value.tableFill[field] as number, min, max, fallback)
	saveCfg()
	toast.success('已保存')
}

function saveRecallField(field: 'maxRecallItems' | 'recallContextDepth' | 'retainFloors', min: number, max: number, fallback: number) {
	const c = cfg.value as unknown as Record<string, unknown>
	c[field] = clampInt(c[field] as number, min, max, fallback)
	saveCfg()
	toast.success('已保存')
}

onActivated(() => {
	cfg.value = session.getConfig()
})
</script>

<template>
	<div class="strategy-page">
		<div class="cn-card strategy-head">
			<CNTabs level="l1" :items="tabs" v-model="activeTabValue" />
		</div>

		<div class="strategy-body">
			<template v-if="activeTab === 'fill'">
				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">自动化</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">自动填表</span>
								<span class="strategy-row__desc">AI 生成回复后自动提取/更新结构化表格。关闭则更新频率归零，设正数自动开启。</span>
							</div>
							<label class="cn-switch">
								<input type="checkbox" v-model="cfg.tableFill.autoFill" @change="onAutoFillChange(cfg.tableFill.autoFill)" />
								<span class="cn-switch__track"></span>
							</label>
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">手动中止时仍触发</span>
								<span class="strategy-row__desc">用户手动中断 AI 生成时是否仍进行纪要总结与表格更新。关闭则手动中止时本轮一并跳过（默认）。</span>
							</div>
							<label class="cn-switch">
								<input type="checkbox" v-model="cfg.pending.summarizeOnManualAbort" @change="saveBoolean('summarizeOnManualAbort')" />
								<span class="cn-switch__track"></span>
							</label>
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">最小回复字数</span>
								<span class="strategy-row__desc">AI 回复少于该字数时跳过本轮纪要总结与表格更新。0=不限制。默认 100。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="10000" step="10"
								v-model.number="cfg.pending.minSummaryLength"
								@blur="saveField('minSummaryLength', 0, 10000, 100)" @change="saveField('minSummaryLength', 0, 10000, 100)" />
						</div>
					</div>
				</section>

				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">触发与批量</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">更新频率</span>
								<span class="strategy-row__desc">积累 N 条新 AI 回复后触发一次填表。1=每条都触发。0=关闭自动填表。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="20" step="1"
								v-model.number="cfg.tableFill.updateFrequency"
								@blur="onUpdateFreqChange(cfg.tableFill.updateFrequency)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">上下文深度</span>
								<span class="strategy-row__desc">AI 填表往回看最近 N 条 AI 回复。0=不传上下文。越大越全但 token 消耗越多。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="50" step="1"
								v-model.number="cfg.tableFill.contextDepth"
								@blur="saveTableField('contextDepth', 0, 50, 3)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">批处理大小</span>
								<span class="strategy-row__desc">待处理消息过多时分多少条一组喂给 AI。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1" max="30" step="1"
								v-model.number="cfg.tableFill.batchSize"
								@blur="saveTableField('batchSize', 1, 30, 3)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">跳过楼层</span>
								<span class="strategy-row__desc">忽略最近 N 条 AI 回复不参与填表。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="20" step="1"
								v-model.number="cfg.tableFill.skipFloors"
								@blur="saveTableField('skipFloors', 0, 20, 0)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">最大重试</span>
								<span class="strategy-row__desc">填表 SQL 执行失败后最多重试几次。0=不重试。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="10" step="1"
								v-model.number="cfg.tableFill.maxRetries"
								@blur="saveTableField('maxRetries', 0, 10, 3)" />
						</div>
					</div>
				</section>

				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">模型</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">表格更新预设</span>
								<span class="strategy-row__desc">表格填表用哪组 AI 预设。{{ presetHint(cfg.tableFillPresetId) }}</span>
							</div>
							<select class="cn-select strategy-select" v-model="cfg.tableFillPresetId" @change="saveCfg">
								<option value="">跟随全局</option>
								<option v-for="p in presetList" :key="p.id" :value="p.id">{{ p.name }}</option>
							</select>
						</div>
					</div>
				</section>
			</template>

			<template v-else-if="activeTab === 'recall'">
				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">自动化</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">纪要生成</span>
								<span class="strategy-row__desc">AI 生成回复后自动提取事件摘要存入纪要表。关闭时联动关闭召回。</span>
							</div>
							<label class="cn-switch">
								<input type="checkbox" v-model="cfg.chronicleGenEnabled" @change="onChronicleGenChange(cfg.chronicleGenEnabled)" />
								<span class="cn-switch__track"></span>
							</label>
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">纪要召回</span>
								<span class="strategy-row__desc">发消息时 AI 筛选相关历史纪要，关键词注入激活世界书条目。</span>
							</div>
							<label class="cn-switch">
								<input type="checkbox" v-model="cfg.recallEnabled" @change="onRecallChange(cfg.recallEnabled)" />
								<span class="cn-switch__track"></span>
							</label>
						</div>
					</div>
				</section>

				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">召回范围</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">最大召回条目</span>
								<span class="strategy-row__desc">每次召回最多注入几条历史纪要。范围 1-50。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1" max="50" step="1"
								v-model.number="cfg.maxRecallItems"
								@blur="saveRecallField('maxRecallItems', 1, 50, 25)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">召回上下文深度</span>
								<span class="strategy-row__desc">召回 AI 筛选纪要时参考的最近对话轮数。范围 1-20。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1" max="20" step="1"
								v-model.number="cfg.recallContextDepth"
								@blur="saveRecallField('recallContextDepth', 1, 20, 5)" />
						</div>
					</div>
				</section>

				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">模型</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">纪要召回预设</span>
								<span class="strategy-row__desc">纪要召回用哪组 AI 预设。{{ presetHint(cfg.recallPresetId) }}</span>
							</div>
							<select class="cn-select strategy-select" v-model="cfg.recallPresetId" @change="saveCfg">
								<option value="">跟随全局</option>
								<option v-for="p in presetList" :key="p.id" :value="p.id">{{ p.name }}</option>
							</select>
						</div>
					</div>
				</section>
			</template>

			<template v-else-if="activeTab === 'snapshot'">
				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">快照</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">快照策略</span>
								<span class="strategy-row__desc">每条消息都存可完整回溯，仅最新更省空间但丢历史。</span>
							</div>
							<CNTabs level="l2" :items="snapshotTabs" v-model="snapshotValue" />
						</div>
						<div v-if="cfg.snapshotStrategy === 'latest-only'" class="strategy-warn">
							<i class="fa-solid fa-triangle-exclamation"></i>
							<span>仅最新模式下，删除最后一条 AI 消息会导致全部表数据丢失！</span>
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">保留楼层</span>
								<span class="strategy-row__desc">只保留最近 N 个 AI 楼层的数据库快照。0=全部保留不清理。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="9999" step="1"
								v-model.number="cfg.retainFloors"
								@blur="saveRecallField('retainFloors', 0, 9999, 100)" />
						</div>
					</div>
				</section>
			</template>

			<template v-else>
				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">超时与重试</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">AI 调用超时（毫秒）</span>
								<span class="strategy-row__desc">单次 AI 请求最长等待时间。默认 60000（60 秒）。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1000" max="600000" step="1000"
								v-model.number="cfg.pending.aiCallTimeoutMs"
								@blur="saveField('aiCallTimeoutMs', 1000, 600000, 60000)" @change="saveField('aiCallTimeoutMs', 1000, 600000, 60000)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">超时后重试次数</span>
								<span class="strategy-row__desc">AI 调用超时后自动重试的次数。0=超时即失败不重试。默认 1。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="10" step="1"
								v-model.number="cfg.pending.aiTimeoutRetries"
								@blur="saveField('aiTimeoutRetries', 0, 10, 1)" @change="saveField('aiTimeoutRetries', 0, 10, 1)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">拉模型列表超时（毫秒）</span>
								<span class="strategy-row__desc">配置 API 时拉取模型列表的最长等待时间。默认 10000（10 秒）。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1000" max="600000" step="1000"
								v-model.number="cfg.pending.listModelsTimeoutMs"
								@blur="saveField('listModelsTimeoutMs', 1000, 600000, 10000)" @change="saveField('listModelsTimeoutMs', 1000, 600000, 10000)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">写队列排空超时（毫秒）</span>
								<span class="strategy-row__desc">切换聊天时等待写入队列排空的最长时间。默认 8000（8 秒）。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1000" max="600000" step="1000"
								v-model.number="cfg.pending.writeQueueDrainTimeoutMs"
								@blur="saveField('writeQueueDrainTimeoutMs', 1000, 600000, 8000)" @change="saveField('writeQueueDrainTimeoutMs', 1000, 600000, 8000)" />
						</div>
					</div>
				</section>
			</template>
		</div>
	</div>
</template>
