<script setup lang="ts">
import { ref, computed } from 'vue'
import { getSession } from '@core/session'
import type { AiPreset, VectorConfig } from '@shared/types/config'
import toast from '@ui/toast'

const session = getSession()

const presets = ref<AiPreset[]>(session.getConfig().aiPresets.map((p) => ({ ...p })))
const activeId = ref(session.getConfig().activeAiPresetId)
const selectedId = ref<string>(activeId.value || (presets.value[0]?.id ?? ''))
const models = ref<string[]>([])
const modelPickerVisible = ref(false)
const modelSearch = ref('')
const drafting = ref(false)
const draftPreset = ref<AiPreset>(emptyPreset())

const filteredModels = computed(() => {
	const kw = modelSearch.value.trim().toLowerCase()
	if (!kw) return models.value
	return models.value.filter((m) => m.toLowerCase().includes(kw))
})

const editing = computed({
	get: () => {
		if (drafting.value) return draftPreset.value
		const found = presets.value.find((p) => p.id === selectedId.value)
		return found ? found : emptyPreset()
	},
	set: (v) => {
		if (drafting.value) {
			draftPreset.value = v
			return
		}
		const idx = presets.value.findIndex((p) => p.id === v.id)
		if (idx >= 0) presets.value[idx] = v
	}
})

const vectorEnabled = ref(session.getConfig().vectorEnabled)
const vector = ref<VectorConfig>({ ...session.getConfig().vector })

function emptyPreset(): AiPreset {
	return {
		id: '', name: '', baseURL: '', apiKey: '', model: '',
		maxTokens: 65536, temperature: 1, topP: 1,
		frequencyPenalty: 0, presencePenalty: 0, seed: -1, stream: false,
		customIncludeBody: '', customExcludeBody: '', customIncludeHeaders: ''
	}
}

function selectPreset(id: string) {
	drafting.value = false
	selectedId.value = id
	models.value = []
}

function createPreset() {
	draftPreset.value = emptyPreset()
	draftPreset.value.id = 'preset_' + Date.now().toString(36)
	drafting.value = true
	models.value = []
}

function cancelDraft() {
	drafting.value = false
	if (presets.value.length > 0) {
		selectedId.value = presets.value[0]!.id
	} else {
		selectedId.value = ''
	}
}

function presetNameExists(name: string, excludeId: string): boolean {
	return presets.value.some((p) => p.name.trim() === name.trim() && p.id !== excludeId)
}

function savePreset() {
	const e = editing.value
	if (!e.name.trim()) { toast.warning('请填写预设名称'); return }
	if (presetNameExists(e.name, e.id)) { toast.warning('预设名称已存在，请使用其他名称'); return }
	if (drafting.value) {
		presets.value.push({ ...e })
		selectedId.value = e.id
		drafting.value = false
	}
	flushPresets()
	toast.success('已保存')
}

function setActive() {
	if (drafting.value) { toast.warning('请先保存当前新建的预设'); return }
	activeId.value = editing.value.id
	flushPresets()
	toast.success('已设为当前')
}

function deletePreset() {
	if (drafting.value) { cancelDraft(); return }
	if (presets.value.length <= 1) { toast.warning('至少保留一个预设'); return }
	presets.value = presets.value.filter((p) => p.id !== selectedId.value)
	if (selectedId.value === activeId.value) activeId.value = presets.value[0]?.id ?? ''
	selectedId.value = presets.value[0]?.id ?? ''
	flushPresets()
	toast.success('已删除')
}

function flushPresets() {
	const c = session.getConfig()
	c.aiPresets = presets.value.map((p) => ({ ...p }))
	c.activeAiPresetId = activeId.value
	session.saveConfig(c)
}

async function fetchModels() {
	if (!editing.value.baseURL) { toast.warning('请先填写 baseURL'); return }
	try {
		models.value = await session.listModels(editing.value)
		if (models.value.length === 0) {
			toast.info('该 API 未返回模型列表，请手动填写 model 名称')
			return
		}
		modelSearch.value = ''
		modelPickerVisible.value = true
	} catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
}

function pickModel(m: string) {
	if (drafting.value) {
		draftPreset.value.model = m
	} else {
		editing.value.model = m
	}
	modelPickerVisible.value = false
}

function saveVector() {
	const c = session.getConfig()
	c.vectorEnabled = vectorEnabled.value
	c.vector = { ...vector.value }
	session.saveConfig(c)
	toast.success('向量配置已保存')
}

function rangeFraction(val: number, min: number, max: number): string {
	const pct = ((val - min) / (max - min)) * 100
	return pct.toFixed(1) + '%'
}
</script>

<template>
	<div class="api-page">
		<div class="api-left">
			<div class="cn-card api-preset-card">
				<div class="cn-card__head">
					<span>API 预设</span>
					<span class="api-head-desc">配置 AI 连接参数，支持 OpenAI 兼容格式</span>
				</div>
				<div class="cn-card__body">
					<div v-if="presets.length === 0 && !drafting" class="cn-empty">
						暂无 API 预设，请新建
						<button class="cn-btn cn-btn--sm" style="margin-left:8px" @click="createPreset"><i class="fa-solid fa-plus"></i> 新建</button>
					</div>

					<template v-else>
						<div class="cn-field">
							<label class="cn-field__label">当前预设</label>
							<div class="api-preset-select-row">
								<select class="cn-select" style="flex:1" :value="drafting ? '__draft__' : selectedId" @change="selectPreset(($event.target as HTMLSelectElement).value)">
									<option v-if="drafting" value="__draft__" disabled>※ 新建预设（未保存）</option>
									<option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}{{ p.id === activeId ? ' ★' : '' }}</option>
								</select>
								<button class="cn-btn cn-btn--sm" @click="createPreset"><i class="fa-solid fa-plus"></i></button>
								<button v-if="!drafting" class="cn-btn cn-btn--sm cn-btn--text" @click="deletePreset"><i class="fa-solid fa-trash"></i></button>
								<button v-else class="cn-btn cn-btn--sm cn-btn--text" @click="cancelDraft" title="取消新建"><i class="fa-solid fa-xmark"></i></button>
							</div>
						</div>

						<div class="api-section-divider"></div>

						<div class="api-form-grid">
							<div class="cn-field">
								<label class="cn-field__label">预设名称</label>
								<input class="cn-input" v-model="editing.name" placeholder="例如: OpenAI GPT-4o" />
							</div>
							<div class="cn-field">
								<label class="cn-field__label">baseURL</label>
								<input class="cn-input" v-model="editing.baseURL" placeholder="https://api.openai.com/v1" />
							</div>
						</div>
						<div class="cn-field">
							<label class="cn-field__label">apiKey</label>
							<input class="cn-input" type="password" v-model="editing.apiKey" placeholder="sk-..." />
						</div>
						<div class="cn-field">
							<label class="cn-field__label">model</label>
							<div class="model-row">
								<input class="cn-input" v-model="editing.model" placeholder="gpt-4o" style="flex:1" />
								<button class="cn-btn cn-btn--sm" @click="fetchModels">获取模型列表</button>
							</div>
						</div>

						<div class="api-section-divider"></div>

						<div class="cn-field">
							<label class="cn-field__label">maxTokens</label>
							<select class="cn-select" v-model.number="editing.maxTokens">
								<option v-for="v in [1024,2048,4096,8192,16384,32768,65536]" :key="v" :value="v">{{ v }}</option>
							</select>
						</div>
						<div class="cn-field">
							<label class="cn-field__label">temperature</label>
							<div class="range-row">
								<input type="range" min="0" max="2" step="0.01" v-model.number="editing.temperature"
									class="cn-range"
									:style="{ '--cn-range-pct': rangeFraction(editing.temperature, 0, 2) }" />
								<input type="number" min="0" max="2" step="0.01" v-model.number="editing.temperature"
									class="cn-input range-num" />
							</div>
						</div>
						<div class="cn-field">
							<label class="cn-field__label">topP</label>
							<div class="range-row">
								<input type="range" min="0" max="1" step="0.01" v-model.number="editing.topP"
									class="cn-range"
									:style="{ '--cn-range-pct': rangeFraction(editing.topP, 0, 1) }" />
								<input type="number" min="0" max="1" step="0.01" v-model.number="editing.topP"
									class="cn-input range-num" />
							</div>
						</div>
						<div class="cn-field">
							<label class="cn-field__label">frequencyPenalty</label>
							<div class="range-row">
								<input type="range" min="-2" max="2" step="0.01" v-model.number="editing.frequencyPenalty"
									class="cn-range"
									:style="{ '--cn-range-pct': rangeFraction(editing.frequencyPenalty, -2, 2) }" />
								<input type="number" min="-2" max="2" step="0.01" v-model.number="editing.frequencyPenalty"
									class="cn-input range-num" />
							</div>
						</div>
						<div class="cn-field">
							<label class="cn-field__label">presencePenalty</label>
							<div class="range-row">
								<input type="range" min="-2" max="2" step="0.01" v-model.number="editing.presencePenalty"
									class="cn-range"
									:style="{ '--cn-range-pct': rangeFraction(editing.presencePenalty, -2, 2) }" />
								<input type="number" min="-2" max="2" step="0.01" v-model.number="editing.presencePenalty"
									class="cn-input range-num" />
							</div>
						</div>
						<div class="cn-field">
							<label class="cn-field__label">seed</label>
							<input class="cn-input" type="number" v-model.number="editing.seed" placeholder="-1 (随机)" />
						</div>
						<label class="cn-check">
							<input type="checkbox" v-model="editing.stream" />
							<span>流式输出 (stream)</span>
						</label>

						<div class="api-section-divider"></div>

						<div class="cn-field">
							<label class="cn-field__label">附加请求体</label>
							<textarea class="cn-textarea" v-model="editing.customIncludeBody" rows="3" placeholder='{"key": "value"}'></textarea>
						</div>
						<div class="cn-field">
							<label class="cn-field__label">排除请求体</label>
							<textarea class="cn-textarea" v-model="editing.customExcludeBody" rows="2" placeholder="每行一个 key"></textarea>
						</div>
						<div class="cn-field">
							<label class="cn-field__label">附加请求标头</label>
							<textarea class="cn-textarea" v-model="editing.customIncludeHeaders" rows="3" placeholder="Header: Value"></textarea>
						</div>

						<div class="api-actions">
							<button class="cn-btn cn-btn--primary" @click="savePreset">{{ drafting ? '创建预设' : '保存' }}</button>
							<button v-if="!drafting" class="cn-btn" :disabled="editing.id === activeId" @click="setActive">{{ editing.id === activeId ? '当前使用中' : '设为当前' }}</button>
							<button v-if="drafting" class="cn-btn" @click="cancelDraft">取消</button>
						</div>
					</template>
				</div>
			</div>
		</div>

		<div class="api-right">
			<div class="cn-card vector-card">
				<div class="cn-card__head">
					<span>向量检索</span>
					<span class="api-head-desc">选开，需单独配置 Embedding API</span>
					<label class="cn-switch" style="margin-left:auto">
						<input type="checkbox" v-model="vectorEnabled" @change="saveVector" />
						<span class="cn-switch__track"></span>
					</label>
				</div>
				<div class="cn-card__body">
					<div class="cn-field"><label class="cn-field__label">endpoint</label><input class="cn-input" v-model="vector.embeddingEndpoint" placeholder="https://api.openai.com/v1/embeddings" /></div>
					<div class="cn-field"><label class="cn-field__label">apiKey</label><input class="cn-input" type="password" v-model="vector.embeddingApiKey" placeholder="sk-..." /></div>
					<div class="cn-field"><label class="cn-field__label">model</label><input class="cn-input" v-model="vector.embeddingModel" placeholder="text-embedding-3-small" /></div>
					<div class="cn-field"><label class="cn-field__label">rerank endpoint</label><input class="cn-input" v-model="vector.rerankEndpoint" placeholder="可选" /></div>
					<div class="cn-field"><label class="cn-field__label">rerank apiKey</label><input class="cn-input" type="password" v-model="vector.rerankApiKey" placeholder="可选" /></div>
					<div class="cn-field"><label class="cn-field__label">rerank model</label><input class="cn-input" v-model="vector.rerankModel" placeholder="rerank-multilingual-v3.0" /></div>
					<button class="cn-btn cn-btn--primary" @click="saveVector" style="margin-top:8px;width:100%">保存向量配置</button>
				</div>
			</div>
		</div>
	</div>

	<div v-if="modelPickerVisible" class="cn-modal-mask" @click.self="modelPickerVisible = false">
		<div class="cn-modal model-picker-modal">
			<div class="cn-modal__head">
				<span>选择模型 — 共 {{ models.length }} 个</span>
				<button class="cn-btn cn-btn--sm cn-btn--text" @click="modelPickerVisible = false">
					<i class="fa-solid fa-xmark"></i>
				</button>
			</div>
			<div class="model-picker__search">
				<input class="cn-input" v-model="modelSearch" placeholder="搜索模型…" />
			</div>
			<div class="model-picker__list">
				<button
					v-for="m in filteredModels"
					:key="m"
					class="model-picker__item"
					:class="{ 'model-picker__item--picked': m === editing.model }"
					@click="pickModel(m)"
				>
					<span class="model-picker__name">{{ m }}</span>
					<i v-if="m === editing.model" class="fa-solid fa-check model-picker__check"></i>
				</button>
				<div v-if="filteredModels.length === 0" class="cn-empty" style="padding:24px 0">
					{{ modelSearch ? '无匹配模型' : '无模型' }}
				</div>
			</div>
		</div>
	</div>
</template>
