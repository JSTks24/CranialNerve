<script setup lang="ts">
import { ref, onActivated, computed } from 'vue'
import { getSession } from '@core/session'
import { runManualFill } from '@core/table/fill-orchestrator'
import type { CranialNerveConfig } from '@shared/types/config'
import toast from '@ui/toast'
import { pushLog } from '@shared/log-buffer'

const session = getSession()
const tableCount = ref(0)
const chronicleCount = ref(0)
const activePresetName = ref('未配置')
const activePresetModel = ref('')
const cfg = ref<CranialNerveConfig>(session.getConfig())

const fillTables = ref<string[]>([])
const fillHint = ref('')
const tableList = ref<string[]>([])
const filling = ref(false)

const presetList = computed(() => session.getConfig().aiPresets)
const hasPresets = computed(() => presetList.value.length > 0)
const hasAI = computed(() => activePresetName.value !== '未配置')
const canFill = computed(() => hasAI.value && fillTables.value.length > 0 && !filling.value && tableList.value.length > 0)

function presetHint(pid: string): string {
	if (!pid) return hasPresets.value ? '跟随全局' : '(无可用预设)'
	const p = presetList.value.find((x) => x.id === pid)
	return p ? p.name : '(已失效)'
}

function tableDisplayName(name: string): string {
	const def = session.getTableDef(name)
	return def?.displayName ?? name
}

function refresh() {
	tableCount.value = session.listTables().filter((n) => n !== 'cn_chronicle').length
	const cr = session.getTableRowsWithRowid('cn_chronicle')
	chronicleCount.value = cr[0]?.rows?.length ?? 0
	const preset = session.getActiveAiPreset()
	activePresetName.value = preset?.name ?? '未配置'
	activePresetModel.value = preset?.model ?? ''
	cfg.value = session.getConfig()
	tableList.value = session.listTables().filter((n) => n !== 'cn_chronicle' && !n.startsWith('sqlite_'))
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

function toggleFillTable(name: string) {
	const idx = fillTables.value.indexOf(name)
	if (idx >= 0) fillTables.value.splice(idx, 1)
	else fillTables.value.push(name)
}

function saveCfg() {
	session.saveConfig(cfg.value)
}

function onChronicleGenChange(v: boolean) {
	if (!v) {
		cfg.value.recallEnabled = false
	}
	saveCfg()
}

function onRecallChange(v: boolean) {
	if (v && !cfg.value.chronicleGenEnabled) {
		cfg.value.chronicleGenEnabled = true
	}
	saveCfg()
}

function onAutoFillChange(v: boolean) {
	if (!v) {
		cfg.value.tableFill.updateFrequency = 0
	} else if (cfg.value.tableFill.updateFrequency <= 0) {
		cfg.value.tableFill.updateFrequency = 1
	}
	saveCfg()
}

function onUpdateFreqChange(raw: unknown) {
	const n = clampInt(typeof raw === 'number' ? raw : 1, 0, 20, 1)
	cfg.value.tableFill.updateFrequency = n
	cfg.value.tableFill.autoFill = n > 0
	saveCfg()
}

function clampInt(raw: number, min: number, max: number, fallback: number): number {
	if (!Number.isFinite(raw) || Number.isNaN(raw)) return fallback
	return Math.max(min, Math.min(max, Math.trunc(raw)))
}

function clampCfgField(field: string, min: number, max: number, fallback: number) {
	const tf = cfg.value.tableFill as unknown as Record<string, unknown>
	if (field in tf) {
		tf[field] = clampInt(tf[field] as unknown as number, min, max, fallback)
	}
	saveCfg()
}

function clampRecallCfg(field: string, min: number, max: number, fallback: number) {
	const c = cfg.value as unknown as Record<string, unknown>
	if (field in c) {
		c[field] = clampInt(c[field] as unknown as number, min, max, fallback)
	}
	saveCfg()
}

function resetDefaults() {
	const c = session.getConfig()
	c.tableFill.autoFill = true
	c.tableFill.contextDepth = 3
	c.tableFill.updateFrequency = 1
	c.tableFill.batchSize = 3
	c.tableFill.skipFloors = 0
	c.tableFill.maxRetries = 3
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
	cfg.value = session.getConfig()
	toast.success('已恢复默认设置')
}

async function triggerFill() {
	if (!canFill.value) return
	filling.value = true
	try {
		const r = await runManualFill(session, fillHint.value)
		if (r.ok) { toast.success(`填表完成（${r.attempts} 次）`); refresh() }
		else { toast.error(r.error ?? '填表失败') }
	} catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
	finally { filling.value = false }
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

		<div class="welcome-grid">
			<div class="cn-card welcome-panel">
				<div class="cn-card__head welcome-panel__head">
					<h3 class="welcome-panel__title">系统状态</h3>
				</div>
				<div class="cn-card__body welcome-panel__body">
					<div class="welcome-health-item welcome-health-item--ok">
						<div class="welcome-health-item__icon"><i class="fa-solid fa-table"></i></div>
						<div class="welcome-health-item__body">
							<strong>数据表</strong>
							<p>{{ tableCount }} 张</p>
						</div>
					</div>
					<div class="welcome-health-item welcome-health-item--ok">
						<div class="welcome-health-item__icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
						<div class="welcome-health-item__body">
							<strong>纪要条目</strong>
							<p>{{ chronicleCount }} 条</p>
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

			<div class="cn-card welcome-panel">
				<div class="cn-card__head welcome-panel__head">
					<h3 class="welcome-panel__title">功能开关</h3>
				</div>
				<div class="cn-card__body welcome-panel__body">
					<div class="welcome-toggle">
						<div class="welcome-toggle__head">
							<span class="welcome-toggle__label">自动填表</span>
							<label class="cn-switch">
								<input type="checkbox" v-model="cfg.tableFill.autoFill" @change="onAutoFillChange(cfg.tableFill.autoFill)" />
								<span class="cn-switch__track"></span>
							</label>
						</div>
						<p class="welcome-toggle__desc">AI 生成回复后自动提取 / 更新结构化表格数据。关闭自动将更新频率归零，将更新频率设为正数则自动开启</p>
					</div>
					<div class="welcome-toggle">
						<div class="welcome-toggle__head">
							<span class="welcome-toggle__label">纪要召回</span>
							<label class="cn-switch">
								<input type="checkbox" v-model="cfg.recallEnabled" @change="onRecallChange(cfg.recallEnabled)" />
								<span class="cn-switch__track"></span>
							</label>
						</div>
						<p class="welcome-toggle__desc">发消息时 AI 筛选相关历史纪要，关键词注入激活世界书条目</p>
					</div>
					<div class="welcome-toggle">
						<div class="welcome-toggle__head">
							<span class="welcome-toggle__label">纪要生成</span>
							<label class="cn-switch">
								<input type="checkbox" v-model="cfg.chronicleGenEnabled" @change="onChronicleGenChange(cfg.chronicleGenEnabled)" />
								<span class="cn-switch__track"></span>
							</label>
						</div>
						<p class="welcome-toggle__desc">AI 生成回复后自动提取事件摘要存入纪要表</p>
					</div>
				</div>
			</div>

			<div class="welcome-stack">
				<div class="cn-card welcome-panel welcome-fill-panel">
					<div class="cn-card__head welcome-panel__head">
						<h3 class="welcome-panel__title">手动填表</h3>
					</div>
					<div class="cn-card__body welcome-panel__body welcome-fill-body">
						<div v-if="tableList.length === 0" class="welcome-fill-empty">
							<i class="fa-solid fa-circle-exclamation" style="color:var(--cn-text-3);font-size:18px;margin-bottom:8px"></i>
							<span>当前会话未载入表格</span>
						</div>
						<template v-else>
							<p class="welcome-fill-desc">勾选需要 AI 更新的数据表，不勾选则更新全部已载入的表</p>
							<div class="welcome-fill-tables">
								<label v-for="t in tableList" :key="t" class="welcome-fill-table">
									<input type="checkbox" :checked="fillTables.includes(t)" @change="toggleFillTable(t)" />
									<span>{{ tableDisplayName(t) }}</span>
									<span class="welcome-fill-en">{{ t }}</span>
								</label>
							</div>
							<textarea class="cn-textarea welcome-fill-hint" v-model="fillHint" placeholder="额外提示词（可选）"></textarea>
							<div class="welcome-fill-actions">
								<button class="cn-btn cn-btn--primary" :disabled="!canFill" @click="triggerFill">
									<i v-if="filling" class="fa-solid fa-spinner fa-spin"></i>
									<i v-else class="fa-solid fa-wand-magic-sparkles"></i>
									{{ filling ? '正在填表…' : '执行填表' }}
								</button>
								<span v-if="!hasAI" class="welcome-fill-note">请先在 API 配置中设置 AI 连接</span>
							</div>
						</template>
					</div>
				</div>

				<div class="cn-card welcome-panel">
					<div class="cn-card__head welcome-panel__head">
						<h3 class="welcome-panel__title">预设分配</h3>
					</div>
					<div class="cn-card__body welcome-panel__body">
						<div class="welcome-preset-row">
							<span class="welcome-preset-row__label">表格更新</span>
							<span class="welcome-preset-row__hint">{{ presetHint(cfg.tableFillPresetId) }}</span>
							<select class="cn-select welcome-preset-row__select" v-model="cfg.tableFillPresetId" @change="saveCfg">
								<option value="">跟随全局</option>
								<option v-for="p in presetList" :key="p.id" :value="p.id">{{ p.name }}</option>
							</select>
						</div>
						<div class="welcome-preset-row">
							<span class="welcome-preset-row__label">纪要召回</span>
							<span class="welcome-preset-row__hint">{{ presetHint(cfg.recallPresetId) }}</span>
							<select class="cn-select welcome-preset-row__select" v-model="cfg.recallPresetId" @change="saveCfg">
								<option value="">跟随全局</option>
								<option v-for="p in presetList" :key="p.id" :value="p.id">{{ p.name }}</option>
							</select>
						</div>
					</div>
				</div>
			</div>

			<div class="cn-card welcome-panel">
				<div class="cn-card__head welcome-panel__head">
					<h3 class="welcome-panel__title">参数配置</h3>
				</div>
				<div class="cn-card__body welcome-panel__body">
					<div class="welcome-kv">
						<div class="welcome-kv__row">
							<span class="welcome-kv__label">上下文深度</span>
							<input class="cn-input welcome-kv__input" type="number" min="0" max="50" step="1"
								v-model.number="cfg.tableFill.contextDepth"
								@blur="clampCfgField('contextDepth', 0, 50, 3)" @change="saveCfg" />
						</div>
						<p class="welcome-kv__desc">AI 填表时往回看最近 N 条 AI 回复。0=不传上下文。越大越全但 token 消耗越多</p>
					</div>
					<div class="welcome-kv">
						<div class="welcome-kv__row">
							<span class="welcome-kv__label">更新频率</span>
							<input class="cn-input welcome-kv__input" type="number" min="0" max="20" step="1"
								v-model.number="cfg.tableFill.updateFrequency"
								@blur="onUpdateFreqChange(cfg.tableFill.updateFrequency)" />
						</div>
						<p class="welcome-kv__desc">积累 N 条新的 AI 回复后触发一次填表。1=每条都触发。设 0 等价于关闭自动填表</p>
					</div>
					<div class="welcome-kv">
						<div class="welcome-kv__row">
							<span class="welcome-kv__label">批处理大小</span>
							<input class="cn-input welcome-kv__input" type="number" min="1" max="30" step="1"
								v-model.number="cfg.tableFill.batchSize"
								@blur="clampCfgField('batchSize', 1, 30, 3)" @change="saveCfg" />
						</div>
						<p class="welcome-kv__desc">待处理消息过多时，分多少条一组喂给 AI。避免一次性塞太多导致遗漏</p>
					</div>
					<div class="welcome-kv">
						<div class="welcome-kv__row">
							<span class="welcome-kv__label">跳过楼层</span>
							<input class="cn-input welcome-kv__input" type="number" min="0" max="20" step="1"
								v-model.number="cfg.tableFill.skipFloors"
								@blur="clampCfgField('skipFloors', 0, 20, 0)" @change="saveCfg" />
						</div>
						<p class="welcome-kv__desc">忽略最近 N 条 AI 回复不参与填表。用于流式未写完或剧情刚转折时让信息沉淀</p>
					</div>
					<div class="welcome-kv">
						<div class="welcome-kv__row">
							<span class="welcome-kv__label">最大重试</span>
							<input class="cn-input welcome-kv__input" type="number" min="0" max="10" step="1"
								v-model.number="cfg.tableFill.maxRetries"
								@blur="clampCfgField('maxRetries', 0, 10, 3)" @change="saveCfg" />
						</div>
						<p class="welcome-kv__desc">填表 SQL 执行失败后最多重试几次。每次重试带错误反馈引导 AI 修正。0=不重试</p>
					</div>
					<div class="welcome-kv">
						<div class="welcome-kv__row">
							<span class="welcome-kv__label">最大召回条目</span>
							<input class="cn-input welcome-kv__input" type="number" min="1" max="50" step="1"
								v-model.number="cfg.maxRecallItems"
								@blur="clampRecallCfg('maxRecallItems', 1, 50, 25)" @change="saveCfg" />
						</div>
						<p class="welcome-kv__desc">每次召回最多注入几条历史纪要。范围 1-50</p>
					</div>
					<div class="welcome-kv">
						<div class="welcome-kv__row">
							<span class="welcome-kv__label">召回上下文深度</span>
							<input class="cn-input welcome-kv__input" type="number" min="1" max="20" step="1"
								v-model.number="cfg.recallContextDepth"
								@blur="clampRecallCfg('recallContextDepth', 1, 20, 5)" @change="saveCfg" />
						</div>
						<p class="welcome-kv__desc">召回 AI 筛选纪要时参考的最近对话轮数。范围 1-20</p>
					</div>
					<div class="welcome-kv">
						<div class="welcome-kv__row">
							<span class="welcome-kv__label">快照策略</span>
							<select class="cn-select welcome-kv__select" v-model="cfg.snapshotStrategy" @change="saveCfg">
								<option value="every-message">每条消息（推荐）</option>
								<option value="latest-only">仅最新 ⚠️</option>
							</select>
						</div>
						<p class="welcome-kv__desc">
							每条消息都存可完整回溯，仅最新更省空间。
							<span v-if="cfg.snapshotStrategy === 'latest-only'" style="color:#fa8c16;font-weight:600">仅最新模式下，删除最后一条 AI 消息会导致全部表数据丢失！</span>
						</p>
					</div>
					<div class="welcome-kv">
						<div class="welcome-kv__row">
							<span class="welcome-kv__label">保留楼层</span>
							<input class="cn-input welcome-kv__input" type="number" min="0" max="9999" step="1"
								v-model.number="cfg.retainFloors"
								@blur="clampRecallCfg('retainFloors', 0, 9999, 100)" @change="saveCfg" />
						</div>
						<p class="welcome-kv__desc">只保留最近 N 个 AI 楼层的数据库快照，旧数据自动清理。0=全部保留不清理</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
