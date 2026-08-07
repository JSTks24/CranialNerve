<script setup lang="ts">
import { ref, computed, watch, onActivated } from 'vue'
import { getSession } from '@core/session'
import type { CranialNerveConfig } from '@shared/types/config'
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
	{ key: 'retain-recent', label: '保留最近N层' },
	{ key: 'latest-only', label: '仅最新' }
]
const snapshotValue = computed({
	get: () => cfg.value.snapshotStrategy,
	set: (v: string) => {
		cfg.value.snapshotStrategy = v as typeof cfg.value.snapshotStrategy
		saveCfg()
	}
})

const autoFillTabs = [
	{ key: 'off', label: '关闭' },
	{ key: 'after-ai', label: 'AI生成后' },
	{ key: 'after-send', label: '输入发送后' }
]
const autoFillValue = computed({
	get: () => cfg.value.tableFill.autoFillTrigger,
	set: (v: string) => {
		cfg.value.tableFill.autoFillTrigger = v as typeof cfg.value.tableFill.autoFillTrigger
		saveCfg()
	}
})
const autoFillFreqDisabled = computed(() => cfg.value.tableFill.autoFillTrigger !== 'after-ai')
const chronicleAutoFillValue = computed({
	get: () => cfg.value.chronicleFill.autoFillTrigger,
	set: (v: string) => {
		cfg.value.chronicleFill.autoFillTrigger = v as typeof cfg.value.chronicleFill.autoFillTrigger
		saveCfg()
	}
})
const chronicleFreqDisabled = computed(() => cfg.value.chronicleFill.autoFillTrigger !== 'after-ai')

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
}

const aiTimeoutText = ref('')
watch(() => cfg.value.pending.aiCallTimeoutMs, (v) => {
	aiTimeoutText.value = v === 0 ? '∞' : String(v)
}, { immediate: true })
function onAiTimeoutInput(e: Event) {
	const input = e.target as HTMLInputElement
	const val = input.value
	if (val === '') {
		aiTimeoutText.value = ''
		return
	}
	if (val === '∞') {
		const display = cfg.value.pending.aiCallTimeoutMs === 0 ? '∞' : String(cfg.value.pending.aiCallTimeoutMs)
		aiTimeoutText.value = display
		input.value = display
		return
	}
	if (/^\d+$/.test(val)) {
		cfg.value.pending.aiCallTimeoutMs = Math.trunc(Number(val))
	}
	const display = cfg.value.pending.aiCallTimeoutMs === 0 ? '∞' : String(cfg.value.pending.aiCallTimeoutMs)
	aiTimeoutText.value = display
	input.value = display
}

function onBlurAiTimeout() {
	if (aiTimeoutText.value === '') {
		cfg.value.pending.aiCallTimeoutMs = 0
	}
	saveField('aiCallTimeoutMs', 0, 600000, 0)
	aiTimeoutText.value = cfg.value.pending.aiCallTimeoutMs === 0 ? '∞' : String(cfg.value.pending.aiCallTimeoutMs)
}

function saveBoolean(field: 'summarizeOnManualAbort') {
	session.saveConfig(cfg.value)
}

function onRecallChange() {
	saveCfg()
}

function onUpdateFreqChange(raw: unknown) {
	const n = clampInt(typeof raw === 'number' ? raw : 1, 1, 20, 1)
	cfg.value.tableFill.updateFrequency = n
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
}

function saveChronicleField(field: 'contextDepth' | 'updateFrequency' | 'batchSize' | 'skipFloors' | 'maxRetries' | 'chronicleSendLatestRows', min: number, max: number, fallback: number) {
	cfg.value.chronicleFill[field] = clampInt(cfg.value.chronicleFill[field] as number, min, max, fallback)
	saveCfg()
}

function saveRecallField(field: 'maxRecallItems' | 'recallContextDepth' | 'retainFloors' | 'checkpointInterval' | 'recallRecentFixedInjectCount', min: number, max: number, fallback: number) {
	const c = cfg.value as unknown as Record<string, unknown>
	c[field] = clampInt(c[field] as number, min, max, fallback)
	saveCfg()
}

function saveRecallFloat(field: 'recallMinScore', min: number, max: number, fallback: number) {
	const raw = cfg.value[field] as number
	cfg.value[field] = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : fallback
	saveCfg()
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
								<span class="strategy-row__desc">选择触发时机。关闭=不自动填；AI生成后=生成完立即填本轮；输入发送后=下次发送时填上一轮（已定型，可先 review/编辑）。</span>
							</div>
							<CNTabs level="l2" :items="autoFillTabs" v-model="autoFillValue" />
						</div>
						<Transition name="cn-fold">
							<div v-if="cfg.tableFill.autoFillTrigger === 'after-ai'" class="strategy-row">
								<div class="strategy-row__text">
									<span class="strategy-row__label">重新生成时自动填表</span>
									<span class="strategy-row__desc">重新生成/swipe 产生新回复后是否自动填表。关闭则需手动填表。</span>
								</div>
								<label class="cn-switch">
									<input type="checkbox" v-model="cfg.tableFill.regenerateFill" @change="saveCfg" />
									<span class="cn-switch__track"></span>
								</label>
							</div>
						</Transition>
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
								@change="saveField('minSummaryLength', 0, 10000, 100)" />
						</div>
					</div>
				</section>

				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">触发与批量（表格更新参数）</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">更新频率</span>
								<span class="strategy-row__desc">积累 N 条新 AI 回复后触发一次填表（仅「AI生成后」模式生效）。1=每条都触发。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1" max="20" step="1"
								:disabled="autoFillFreqDisabled"
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
								@blur="saveTableField('batchSize', 1, 30, 10)" />
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
								<span class="strategy-row__label">自动生成纪要</span>
								<span class="strategy-row__desc">选择触发时机。关闭=不自动生成；AI生成后=生成完立即生成纪要；输入发送后=下次发送时生成上一轮纪要。</span>
							</div>
							<CNTabs level="l2" :items="autoFillTabs" v-model="chronicleAutoFillValue" />
						</div>
						<Transition name="cn-fold">
							<div v-if="cfg.chronicleFill.autoFillTrigger === 'after-ai'" class="strategy-row">
								<div class="strategy-row__text">
									<span class="strategy-row__label">重新生成时自动生成纪要</span>
									<span class="strategy-row__desc">重新生成/swipe 产生新回复后是否自动生成纪要。关闭则需手动生成。</span>
								</div>
								<label class="cn-switch">
									<input type="checkbox" v-model="cfg.chronicleFill.regenerateFill" @change="saveCfg" />
									<span class="cn-switch__track"></span>
								</label>
							</div>
						</Transition>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">纪要召回</span>
								<span class="strategy-row__desc">发消息时 AI 筛选相关历史纪要，关键词注入激活世界书条目。</span>
							</div>
							<label class="cn-switch">
								<input type="checkbox" v-model="cfg.recallEnabled" @change="onRecallChange" />
								<span class="cn-switch__track"></span>
							</label>
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">手动中止时仍触发</span>
								<span class="strategy-row__desc">与表格更新共用。用户手动中断 AI 生成时是否仍生成纪要/更新表格。</span>
							</div>
							<label class="cn-switch">
								<input type="checkbox" v-model="cfg.pending.summarizeOnManualAbort" @change="saveBoolean('summarizeOnManualAbort')" />
								<span class="cn-switch__track"></span>
							</label>
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">最小回复字数</span>
								<span class="strategy-row__desc">与表格更新共用。AI 回复少于该字数时跳过本轮。0=不限制。默认 100。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="10000" step="10"
								v-model.number="cfg.pending.minSummaryLength"
								@change="saveField('minSummaryLength', 0, 10000, 100)" />
						</div>
					</div>
				</section>

				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">触发与批量（纪要生成参数）</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">更新频率</span>
								<span class="strategy-row__desc">积累 N 条新 AI 回复后触发一次纪要生成（仅「AI生成后」模式生效）。1=每条都触发。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1" max="20" step="1"
								:disabled="chronicleFreqDisabled"
								v-model.number="cfg.chronicleFill.updateFrequency"
								@blur="saveChronicleField('updateFrequency', 1, 20, 1)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">上下文深度</span>
								<span class="strategy-row__desc">纪要生成 AI 往回看最近 N 条 AI 回复。0=不传上下文。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="50" step="1"
								v-model.number="cfg.chronicleFill.contextDepth"
								@blur="saveChronicleField('contextDepth', 0, 50, 3)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">批处理大小</span>
								<span class="strategy-row__desc">待处理消息过多时分多少条一组喂给 AI。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1" max="30" step="1"
								v-model.number="cfg.chronicleFill.batchSize"
								@blur="saveChronicleField('batchSize', 1, 30, 10)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">跳过楼层</span>
								<span class="strategy-row__desc">忽略最近 N 条 AI 回复不参与纪要生成。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="20" step="1"
								v-model.number="cfg.chronicleFill.skipFloors"
								@blur="saveChronicleField('skipFloors', 0, 20, 0)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">最大重试</span>
								<span class="strategy-row__desc">纪要 SQL 执行失败后最多重试几次。0=不重试。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="10" step="1"
								v-model.number="cfg.chronicleFill.maxRetries"
								@blur="saveChronicleField('maxRetries', 0, 10, 3)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">发送最新行数</span>
								<span class="strategy-row__desc">纪要生成提示词里附带的最近几条纪要（AI 参考既有纪要风格）。0=不带。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="50" step="1"
								v-model.number="cfg.chronicleFill.chronicleSendLatestRows"
								@blur="saveChronicleField('chronicleSendLatestRows', 0, 50, 10)" />
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
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">固定注入条数</span>
								<span class="strategy-row__desc">每次发消息固定注入最近 N 条纪要进 AI 上下文（不经过筛）。0=不固定注入。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="20" step="1"
								v-model.number="cfg.recallRecentFixedInjectCount"
								@blur="saveRecallField('recallRecentFixedInjectCount', 0, 20, 5)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">最低相关分</span>
								<span class="strategy-row__desc">向量召回得分低于该值的纪要不进候选。范围 0-1，0=不限制。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="1" step="0.05"
								v-model.number="cfg.recallMinScore"
								@blur="saveRecallFloat('recallMinScore', 0, 1, 0.45)" />
						</div>
					</div>
				</section>

				<section class="cn-card strategy-section">
					<div class="strategy-section__head"><span class="strategy-section__title">模型</span></div>
					<div class="strategy-rows">
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">纪要生成预设</span>
								<span class="strategy-row__desc">纪要生成用哪组 AI 预设。{{ presetHint(cfg.chronicleGenPresetId) }}</span>
							</div>
							<select class="cn-select strategy-select" v-model="cfg.chronicleGenPresetId" @change="saveCfg">
								<option value="">跟随全局</option>
								<option v-for="p in presetList" :key="p.id" :value="p.id">{{ p.name }}</option>
							</select>
						</div>
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
								<span class="strategy-row__desc">每条消息都存可完整回溯；保留最近N层省空间且保基线；仅最新只留一份全量。</span>
							</div>
							<CNTabs level="l2" :items="snapshotTabs" v-model="snapshotValue" />
						</div>
						<div v-if="cfg.snapshotStrategy === 'latest-only'" class="strategy-warn">
							<i class="fa-solid fa-triangle-exclamation"></i>
							<span>仅最新模式下，删除最后一条 AI 消息会导致全部表数据丢失！</span>
						</div>
						<div v-if="cfg.snapshotStrategy === 'retain-recent'" class="strategy-warn">
							<i class="fa-solid fa-circle-info"></i>
							<span>保留最近N层：超出保留数的旧楼层快照会被丢弃，但始终保留一个基线快照供回放。</span>
						</div>
						<div v-if="cfg.snapshotStrategy !== 'latest-only'" class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">定期全量间隔</span>
								<span class="strategy-row__desc">每 N 个 AI 楼层写一个全量快照基线，避免回放过长。0=只在首次写。默认 20。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="9999" step="1"
								v-model.number="cfg.checkpointInterval"
								@blur="saveRecallField('checkpointInterval', 0, 9999, 20)" />
						</div>
						<div v-if="cfg.snapshotStrategy === 'retain-recent'" class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">保留楼层</span>
								<span class="strategy-row__desc">只保留最近 N 个 AI 楼层的快照，超出丢弃。0=全部保留不清理。</span>
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
								<span class="strategy-row__desc">单次 AI 请求最长等待时间。0=永不超时。默认 0。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="text" inputmode="numeric"
								:value="aiTimeoutText"
								@input="onAiTimeoutInput"
								@blur="onBlurAiTimeout" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">超时后重试次数</span>
								<span class="strategy-row__desc">AI 调用超时后自动重试的次数。0=超时即失败不重试。默认 1。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="0" max="10" step="1"
								v-model.number="cfg.pending.aiTimeoutRetries"
								@change="saveField('aiTimeoutRetries', 0, 10, 1)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">拉模型列表超时（毫秒）</span>
								<span class="strategy-row__desc">配置 API 时拉取模型列表的最长等待时间。默认 10000（10 秒）。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1000" max="600000" step="1000"
								v-model.number="cfg.pending.listModelsTimeoutMs"
								@change="saveField('listModelsTimeoutMs', 1000, 600000, 10000)" />
						</div>
						<div class="strategy-row">
							<div class="strategy-row__text">
								<span class="strategy-row__label">写队列排空超时（毫秒）</span>
								<span class="strategy-row__desc">切换聊天时等待写入队列排空的最长时间。默认 8000（8 秒）。</span>
							</div>
							<input class="cn-input cn-input--nospin strategy-num" type="number" min="1000" max="600000" step="1000"
								v-model.number="cfg.pending.writeQueueDrainTimeoutMs"
								@change="saveField('writeQueueDrainTimeoutMs', 1000, 600000, 8000)" />
						</div>
					</div>
				</section>
			</template>
		</div>
	</div>
</template>
