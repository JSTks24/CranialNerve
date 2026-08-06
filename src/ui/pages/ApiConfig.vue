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
const advancedOpen = ref(false)

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

const seedInput = computed({
  get: () => editing.value.seed === null ? '' : String(editing.value.seed),
  set: (v) => { editing.value.seed = v === '' ? null : Number(v) }
})

const vectorEnabled = ref(session.getConfig().vectorEnabled)
const vector = ref<VectorConfig>({ ...session.getConfig().vector })

function emptyPreset(): AiPreset {
  return {
    id: '',
    name: '',
    baseURL: '',
    apiKey: '',
    model: '',
    maxTokens: 65536,
    temperature: 1,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    seed: null,
    stream: false,
    responseFormat: 'none',
    customIncludeBody: '',
    customExcludeBody: '',
    customIncludeHeaders: ''
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
  if (!e.name.trim()) {
    toast.warning('请填写预设名称')
    return
  }
  if (presetNameExists(e.name, e.id)) {
    toast.warning('预设名称已存在，请使用其他名称')
    return
  }
  if (!e.baseURL.trim()) {
    toast.warning('请填写 baseURL')
    return
  }
  if (!e.model.trim()) {
    toast.warning('请填写 model')
    return
  }
  if (drafting.value) {
    presets.value.push({ ...e })
    selectedId.value = e.id
    drafting.value = false
  }
  flushPresets()
  toast.success('已保存')
}

function setActive() {
  if (drafting.value) {
    toast.warning('请先保存当前新建的预设')
    return
  }
  activeId.value = editing.value.id
  flushPresets()
  toast.success('已设为当前')
}

function deletePreset() {
  if (drafting.value) {
    cancelDraft()
    return
  }
  if (presets.value.length <= 1) {
    toast.warning('至少保留一个预设')
    return
  }
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
  if (!editing.value.baseURL) {
    toast.warning('请先填写 baseURL')
    return
  }
  try {
    models.value = await session.listModels(editing.value)
    if (models.value.length === 0) {
      toast.info('该 API 未返回模型列表，请手动填写 model 名称')
      return
    }
    modelSearch.value = ''
    modelPickerVisible.value = true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function pickModel(m: string) {
  if (drafting.value) {
    draftPreset.value.model = m
  } else {
    editing.value.model = m
  }
  modelPickerVisible.value = false
}

const vectorModels = ref<string[]>([])
const vectorPickerVisible = ref(false)
const vectorModelSearch = ref('')

const filteredVectorModels = computed(() => {
  const kw = vectorModelSearch.value.trim().toLowerCase()
  if (!kw) return vectorModels.value
  return vectorModels.value.filter((m) => m.toLowerCase().includes(kw))
})

const rerankModels = ref<string[]>([])
const rerankPickerVisible = ref(false)
const rerankModelSearch = ref('')

const filteredRerankModels = computed(() => {
  const kw = rerankModelSearch.value.trim().toLowerCase()
  if (!kw) return rerankModels.value
  return rerankModels.value.filter((m) => m.toLowerCase().includes(kw))
})

async function fetchVectorModels() {
  if (!vector.value.embeddingEndpoint) {
    toast.warning('请先填写 endpoint')
    return
  }
  try {
    const tempPreset: AiPreset = {
      id: '__vector__',
      name: '__vector__',
      baseURL: vector.value.embeddingEndpoint,
      apiKey: vector.value.embeddingApiKey,
      model: vector.value.embeddingModel,
      maxTokens: 0,
      temperature: 1,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      seed: null,
      stream: false,
      responseFormat: 'none',
      customIncludeBody: '',
      customExcludeBody: '',
      customIncludeHeaders: ''
    }
    vectorModels.value = await session.listModels(tempPreset)
    if (vectorModels.value.length === 0) {
      toast.info('该 API 未返回模型列表，请手动填写 model 名称')
      return
    }
    vectorModelSearch.value = ''
    vectorPickerVisible.value = true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function pickVectorModel(m: string) {
  vector.value.embeddingModel = m
  vectorPickerVisible.value = false
}

async function fetchRerankModels() {
  if (!vector.value.rerankEndpoint) {
    toast.warning('请先填写 rerank endpoint')
    return
  }
  try {
    const tempPreset: AiPreset = {
      id: '__rerank__',
      name: '__rerank__',
      baseURL: vector.value.rerankEndpoint,
      apiKey: vector.value.rerankApiKey,
      model: vector.value.rerankModel,
      maxTokens: 0,
      temperature: 1,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      seed: null,
      stream: false,
      responseFormat: 'none',
      customIncludeBody: '',
      customExcludeBody: '',
      customIncludeHeaders: ''
    }
    rerankModels.value = await session.listModels(tempPreset)
    if (rerankModels.value.length === 0) {
      toast.info('该 API 未返回模型列表，请手动填写 model 名称')
      return
    }
    rerankModelSearch.value = ''
    rerankPickerVisible.value = true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function pickRerankModel(m: string) {
  vector.value.rerankModel = m
  rerankPickerVisible.value = false
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
    <div class="api-group">
      <div class="cn-card api-preset-list">
        <div class="cn-card__head"><span>API 预设</span></div>
        <div class="cn-card__body api-preset-list__body">
          <button
            v-for="p in presets"
            :key="p.id"
            class="api-preset-item"
            :class="{ 'api-preset-item--active': !drafting && p.id === selectedId }"
            @click="selectPreset(p.id)"
          >
            <span class="api-preset-item__name">{{ p.name }}</span>
            <i v-if="p.id === activeId" class="fa-solid fa-star api-preset-item__star"></i>
          </button>
          <button v-if="drafting" class="api-preset-item api-preset-item--active" disabled>
            <span class="api-preset-item__name">※ 新建（未保存）</span>
          </button>
          <button class="api-preset-list__new" @click="createPreset">
            <i class="fa-solid fa-plus"></i> 新建预设
          </button>
          <button
            v-if="!drafting && presets.length > 1"
            class="api-preset-list__del"
            @click="deletePreset"
          >
            <i class="fa-solid fa-trash"></i> 删除当前
          </button>
        </div>
      </div>

      <div class="cn-card api-editor">
        <div class="cn-card__head">
          <span>编辑预设</span>
          <span class="api-head-desc">配置 AI 连接参数，支持 OpenAI 兼容格式</span>
        </div>
        <div class="cn-card__body">
          <div v-if="presets.length === 0 && !drafting" class="cn-empty cn-empty--compact">
            暂无 API 预设，请点击左侧「新建预设」
          </div>

          <template v-else>
            <div class="api-form-grid">
              <div class="cn-field">
                <label class="cn-field__label">预设名称</label>
                <input class="cn-input" v-model="editing.name" placeholder="例如: OpenAI GPT-4o" />
              </div>
              <div class="cn-field">
                <label class="cn-field__label">baseURL</label>
                <input
                  class="cn-input"
                  v-model="editing.baseURL"
                  placeholder="https://api.openai.com/v1"
                />
              </div>
            </div>
            <div class="cn-field">
              <label class="cn-field__label">apiKey</label>
              <input
                class="cn-input"
                type="password"
                v-model="editing.apiKey"
                placeholder="sk-..."
              />
            </div>
            <div class="cn-field">
              <label class="cn-field__label">model</label>
              <div class="model-row">
                <input
                  class="cn-input"
                  v-model="editing.model"
                  placeholder="gpt-4o"
                  style="flex: 1"
                />
                <button class="cn-btn cn-btn--sm" @click="fetchModels">获取模型列表</button>
              </div>
            </div>

            <div class="api-section-divider"></div>

            <div class="api-sampling-grid">
              <div class="cn-field">
                <label class="cn-field__label">maxTokens</label>
                <input
                  class="cn-input cn-input--nospin"
                  type="number"
                  v-model.number="editing.maxTokens"
                  placeholder="65536"
                />
              </div>
              <div class="cn-field">
                <label class="cn-field__label">seed</label>
                <input
                  class="cn-input cn-input--nospin"
                  type="number"
                  v-model="seedInput"
                  placeholder="默认（随机）"
                />
              </div>
              <div class="cn-field">
                <label class="cn-field__label">temperature</label>
                <div class="range-row">
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.01"
                    v-model.number="editing.temperature"
                    class="cn-range"
                    :style="{ '--cn-range-pct': rangeFraction(editing.temperature, 0, 2) }"
                  />
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.01"
                    v-model.number="editing.temperature"
                    class="cn-input range-num"
                  />
                </div>
              </div>
              <div class="cn-field">
                <label class="cn-field__label">topP</label>
                <div class="range-row">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    v-model.number="editing.topP"
                    class="cn-range"
                    :style="{ '--cn-range-pct': rangeFraction(editing.topP, 0, 1) }"
                  />
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    v-model.number="editing.topP"
                    class="cn-input range-num"
                  />
                </div>
              </div>
              <div class="cn-field">
                <label class="cn-field__label">frequencyPenalty</label>
                <div class="range-row">
                  <input
                    type="range"
                    min="-2"
                    max="2"
                    step="0.01"
                    v-model.number="editing.frequencyPenalty"
                    class="cn-range"
                    :style="{ '--cn-range-pct': rangeFraction(editing.frequencyPenalty, -2, 2) }"
                  />
                  <input
                    type="number"
                    min="-2"
                    max="2"
                    step="0.01"
                    v-model.number="editing.frequencyPenalty"
                    class="cn-input range-num"
                  />
                </div>
              </div>
              <div class="cn-field">
                <label class="cn-field__label">presencePenalty</label>
                <div class="range-row">
                  <input
                    type="range"
                    min="-2"
                    max="2"
                    step="0.01"
                    v-model.number="editing.presencePenalty"
                    class="cn-range"
                    :style="{ '--cn-range-pct': rangeFraction(editing.presencePenalty, -2, 2) }"
                  />
                  <input
                    type="number"
                    min="-2"
                    max="2"
                    step="0.01"
                    v-model.number="editing.presencePenalty"
                    class="cn-input range-num"
                  />
                </div>
              </div>
            </div>
            <div class="api-switch-group">
              <label class="cn-switch">
                <input type="checkbox" v-model="editing.stream" />
                <span class="cn-switch__track"></span>
                <span class="cn-switch__label">流式输出 (stream)</span>
              </label>
              <label class="cn-switch">
                <input
                  type="checkbox"
                  :checked="editing.responseFormat === 'json_object'"
                  @change="editing.responseFormat = $event.target.checked ? 'json_object' : 'none'"
                />
                <span class="cn-switch__track"></span>
                <span class="cn-switch__label">JSON 输出模式 (json_object)</span>
              </label>
            </div>

            <div class="api-section-divider"></div>

            <button class="api-advanced-toggle" @click="advancedOpen = !advancedOpen">
              <i
                class="fa-solid fa-chevron-right api-advanced-toggle__icon"
                :class="{ 'api-advanced-toggle__icon--open': advancedOpen }"
              ></i>
              高级配置
            </button>
            <Transition name="cn-fold">
              <div v-if="advancedOpen" class="api-advanced">
                <div class="cn-field">
                  <label class="cn-field__label">附加请求体</label>
                  <textarea
                    class="cn-textarea"
                    v-model="editing.customIncludeBody"
                    rows="3"
                    placeholder='{"key": "value"}'
                  ></textarea>
                </div>
                <div class="cn-field">
                  <label class="cn-field__label">排除请求体</label>
                  <textarea
                    class="cn-textarea"
                    v-model="editing.customExcludeBody"
                    rows="2"
                    placeholder="每行一个 key"
                  ></textarea>
                </div>
                <div class="cn-field">
                  <label class="cn-field__label">附加请求标头</label>
                  <textarea
                    class="cn-textarea"
                    v-model="editing.customIncludeHeaders"
                    rows="3"
                    placeholder="Header: Value"
                  ></textarea>
                </div>
              </div>
            </Transition>

            <div class="api-actions">
              <button class="cn-btn cn-btn--primary" @click="savePreset">
                {{ drafting ? '创建预设' : '保存' }}
              </button>
              <button
                v-if="!drafting"
                class="cn-btn"
                :disabled="editing.id === activeId"
                @click="setActive"
              >
                {{ editing.id === activeId ? '当前使用中' : '设为当前' }}
              </button>
              <button v-if="drafting" class="cn-btn" @click="cancelDraft">取消</button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div class="cn-card api-vector">
      <div class="cn-card__head">
        <span>向量检索</span>
        <span class="api-head-desc">选开，需单独配置 Embedding API</span>
        <label class="cn-switch" style="margin-left: auto">
          <input type="checkbox" v-model="vectorEnabled" @change="saveVector" />
          <span class="cn-switch__track"></span>
        </label>
      </div>
      <div class="cn-card__body">
        <div class="cn-field">
          <label class="cn-field__label">endpoint</label>
          <input
            class="cn-input"
            v-model="vector.embeddingEndpoint"
            placeholder="https://api.openai.com/v1/embeddings"
          />
        </div>
        <div class="cn-field">
          <label class="cn-field__label">apiKey</label>
          <input
            class="cn-input"
            type="password"
            v-model="vector.embeddingApiKey"
            placeholder="sk-..."
          />
        </div>
        <div class="cn-field">
          <label class="cn-field__label">model</label>
          <div class="model-row">
            <input
              class="cn-input"
              v-model="vector.embeddingModel"
              placeholder="text-embedding-3-small"
              style="flex: 1"
            />
            <button class="cn-btn cn-btn--sm" @click="fetchVectorModels">获取模型列表</button>
          </div>
        </div>
        <div class="api-section-divider"></div>
        <div class="cn-field">
          <label class="cn-field__label">rerank endpoint</label>
          <input class="cn-input" v-model="vector.rerankEndpoint" placeholder="可选" />
        </div>
        <div class="cn-field">
          <label class="cn-field__label">rerank apiKey</label>
          <input
            class="cn-input"
            type="password"
            v-model="vector.rerankApiKey"
            placeholder="可选"
          />
        </div>
        <div class="cn-field">
          <label class="cn-field__label">rerank model</label>
          <div class="model-row">
            <input
              class="cn-input"
              v-model="vector.rerankModel"
              placeholder="rerank-multilingual-v3.0"
              style="flex: 1"
            />
            <button class="cn-btn cn-btn--sm" @click="fetchRerankModels">获取模型列表</button>
          </div>
        </div>
        <button
          class="cn-btn cn-btn--primary cn-btn--block"
          @click="saveVector"
        >
          保存向量配置
        </button>
      </div>
    </div>
  </div>

  <Transition name="cn-modal">
    <div v-if="modelPickerVisible" class="cn-modal-mask" @click.self="modelPickerVisible = false">
      <div class="cn-modal model-picker-modal">
        <div class="cn-modal__head">
          <span>选择模型 - 共 {{ models.length }} 个</span>
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
          <div v-if="filteredModels.length === 0" class="cn-empty" style="padding: 24px 0">
            {{ modelSearch ? '无匹配模型' : '无模型' }}
          </div>
        </div>
      </div>
    </div>
  </Transition>

  <Transition name="cn-modal">
    <div v-if="vectorPickerVisible" class="cn-modal-mask" @click.self="vectorPickerVisible = false">
      <div class="cn-modal model-picker-modal">
        <div class="cn-modal__head">
          <span>选择 Embedding 模型 - 共 {{ vectorModels.length }} 个</span>
          <button class="cn-btn cn-btn--sm cn-btn--text" @click="vectorPickerVisible = false">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="model-picker__search">
          <input class="cn-input" v-model="vectorModelSearch" placeholder="搜索模型…" />
        </div>
        <div class="model-picker__list">
          <button
            v-for="m in filteredVectorModels"
            :key="m"
            class="model-picker__item"
            :class="{ 'model-picker__item--picked': m === vector.embeddingModel }"
            @click="pickVectorModel(m)"
          >
            <span class="model-picker__name">{{ m }}</span>
            <i v-if="m === vector.embeddingModel" class="fa-solid fa-check model-picker__check"></i>
          </button>
          <div v-if="filteredVectorModels.length === 0" class="cn-empty" style="padding: 24px 0">
            {{ vectorModelSearch ? '无匹配模型' : '无模型' }}
          </div>
        </div>
      </div>
    </div>
  </Transition>

  <Transition name="cn-modal">
    <div v-if="rerankPickerVisible" class="cn-modal-mask" @click.self="rerankPickerVisible = false">
      <div class="cn-modal model-picker-modal">
        <div class="cn-modal__head">
          <span>选择 Rerank 模型 - 共 {{ rerankModels.length }} 个</span>
          <button class="cn-btn cn-btn--sm cn-btn--text" @click="rerankPickerVisible = false">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="model-picker__search">
          <input class="cn-input" v-model="rerankModelSearch" placeholder="搜索模型…" />
        </div>
        <div class="model-picker__list">
          <button
            v-for="m in filteredRerankModels"
            :key="m"
            class="model-picker__item"
            :class="{ 'model-picker__item--picked': m === vector.rerankModel }"
            @click="pickRerankModel(m)"
          >
            <span class="model-picker__name">{{ m }}</span>
            <i v-if="m === vector.rerankModel" class="fa-solid fa-check model-picker__check"></i>
          </button>
          <div v-if="filteredRerankModels.length === 0" class="cn-empty" style="padding: 24px 0">
            {{ rerankModelSearch ? '无匹配模型' : '无模型' }}
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
