<script setup lang="ts">
import { ref, computed, onActivated } from 'vue'
import { getSession } from '@core/session'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import { detectLastSummarizedAiFloor } from '@core/table/fill-orchestrator'
import type { FillPhase } from '@core/table/retry-loop'
import type { CranialNerveConfig } from '@shared/types/config'
import confirm from '@ui/dialog'

const session = getSession()
const cfg = ref<CranialNerveConfig>(session.getConfig())

const availableTables = computed(() => {
  const names = session.listTables().filter((n) => !n.startsWith('sqlite_') && n !== CHRONICLE_TABLE_NAME)
  return names.map((n) => {
    const def = session.getTableDef(n)
    return { name: n, displayName: def?.displayName || n }
  })
})
const selectedTables = ref<string[]>([...(cfg.value.tableFill.manualSelectedTables || [])])
const includeChronicle = ref(true)
const manualDepth = ref<number | null>(cfg.value.tableFill.manualUpdateContextDepth)
const manualBatch = ref<number | null>(cfg.value.tableFill.manualUpdateBatchSize)
const extraHint = ref('')
const busy = ref(false)

const phase = ref<FillPhase | null>(null)
const attempt = ref(0)
const maxRetries = ref(0)
const currentBucket = ref(0)
const totalBuckets = ref(0)
const errorMsg = ref('')
const lastResult = ref<{ ok: boolean; text: string } | null>(null)

function defaultInput(r: { value: number | null }, fallback: number) {
  return computed({
    get: () => (r.value === null ? String(fallback) : String(r.value)),
    set: (v: string) => { r.value = v === '' ? null : Number(v) }
  })
}
const manualDepthInput = defaultInput(manualDepth, cfg.value.tableFill.contextDepth)
const manualBatchInput = defaultInput(manualBatch, cfg.value.tableFill.batchSize)

function clampInt(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(raw)))
}

const aiFloorCount = computed(() => session.chat.getChat().filter((m) => !m.is_user && !m.is_system).length)
const lastSummarized = computed(() => detectLastSummarizedAiFloor(session))
const summarizedAiCount = computed(() => {
  const last = lastSummarized.value
  if (last == null) return 0
  return session.chat.getChat().slice(0, last + 1).filter((m) => !m.is_user && !m.is_system).length
})
const unrecordedCount = computed(() => Math.max(0, aiFloorCount.value - summarizedAiCount.value))
const expectedRange = computed(() => {
  const chat = session.chat.getChat()
  const depth = manualDepth.value ?? cfg.value.tableFill.contextDepth
  if (depth <= 0 || chat.length === 0) return '全部消息'
  const start = Math.max(0, chat.length - depth)
  const end = chat.length - 1
  const aiBefore = chat.slice(0, start).filter((m) => !m.is_user && !m.is_system).length
  const aiInSlice = chat.slice(start, end + 1).filter((m) => !m.is_user && !m.is_system).length
  const aiLabel = aiInSlice > 0 ? `（AI ${aiBefore + 1}~${aiBefore + aiInSlice}）` : ''
  return `第 ${start}~${end} 层${aiLabel}`
})

const steps = computed(() => {
  const p = phase.value
  return [
    { label: '调用 AI', done: p === 'parsing' || p === 'saving' || p === 'complete', active: p === 'calling_ai' || p === 'retry' },
    { label: '解析结果', done: p === 'saving' || p === 'complete', active: p === 'parsing' },
    { label: '保存数据', done: p === 'complete', active: p === 'saving' },
    { label: '完成', done: false, active: p === 'complete' },
  ]
})

const progressPercent = computed(() => {
  if (phase.value === 'complete' || phase.value === 'error') return 100
  if (totalBuckets.value === 0) {
    switch (phase.value) {
      case 'calling_ai': case 'retry': return 25
      case 'parsing': return 50
      case 'saving': return 75
      default: return 0
    }
  }
  const cur = currentBucket.value || 1
  let phasePct = 0
  switch (phase.value) {
    case 'calling_ai': case 'retry': phasePct = 25; break
    case 'parsing': phasePct = 50; break
    case 'saving': phasePct = 75; break
  }
  return ((cur - 1) * 100 + phasePct) / totalBuckets.value
})

function selectAllTables() {
  selectedTables.value = availableTables.value.map((t) => t.name)
  saveSelection()
}
function selectNoTables() {
  selectedTables.value = []
  saveSelection()
}
function saveSelection() {
  cfg.value.tableFill.manualSelectedTables = [...selectedTables.value]
  cfg.value.tableFill.hasManualSelection = true
  session.saveConfig(cfg.value)
}
function saveManualDepth() {
  const v = manualDepth.value
  cfg.value.tableFill.manualUpdateContextDepth = v === null ? null : clampInt(v, 0, 50, 0)
  manualDepth.value = cfg.value.tableFill.manualUpdateContextDepth
  session.saveConfig(cfg.value)
}
function saveManualBatch() {
  const v = manualBatch.value
  cfg.value.tableFill.manualUpdateBatchSize = v === null ? null : clampInt(v, 1, 50, 1)
  manualBatch.value = cfg.value.tableFill.manualUpdateBatchSize
  session.saveConfig(cfg.value)
}

function onProgress(p: FillPhase, detail?: { attempt?: number; maxRetries?: number; error?: string; currentBucket?: number; totalBuckets?: number }) {
  phase.value = p
  if (detail?.attempt != null) attempt.value = detail.attempt
  if (detail?.maxRetries != null) maxRetries.value = detail.maxRetries
  if (detail?.error) errorMsg.value = detail.error
  if (detail?.currentBucket != null) currentBucket.value = detail.currentBucket
  if (detail?.totalBuckets != null) totalBuckets.value = detail.totalBuckets
}

function resetProgress() {
  phase.value = null
  attempt.value = 0
  maxRetries.value = 0
  currentBucket.value = 0
  totalBuckets.value = 0
  errorMsg.value = ''
  lastResult.value = null
}

async function runRefill() {
  if (busy.value || selectedTables.value.length === 0) return
  const confirmed = await confirm('执行手动填表', '是否执行手动填表？若相关层数有数据，则数据会丢失。', '确认执行', true)
  if (!confirmed) return
  busy.value = true
  resetProgress()
  try {
    const result = await session.runManualRefill({
      targetTables: selectedTables.value,
      includeChronicle: includeChronicle.value,
      contextDepth: manualDepth.value ?? undefined,
      batchSize: manualBatch.value ?? undefined,
      skipFloors: cfg.value.tableFill.skipFloors,
      extraHint: extraHint.value.trim() || undefined,
      onProgress,
    })
    lastResult.value = result.ok ? { ok: true, text: '重填完成' } : { ok: false, text: result.error ?? '重填失败' }
  } catch (e) {
    lastResult.value = { ok: false, text: e instanceof Error ? e.message : String(e) }
  } finally {
    busy.value = false
  }
}

async function runCatchUp() {
  if (busy.value) return
  const confirmed = await confirm(
    '追平未总结楼层',
    '将根据楼层范围补填表格与纪要（不清空数据）。留空=自动检测最近未总结楼层。',
    '确认追平'
  )
  if (!confirmed) return
  busy.value = true
  resetProgress()
  try {
    const result = await session.runManualCatchUp({
      targetTables: selectedTables.value.length > 0 ? selectedTables.value : undefined,
      includeChronicle: includeChronicle.value,
      batchSize: manualBatch.value ?? undefined,
      extraHint: extraHint.value.trim() || undefined,
      onProgress,
    })
    lastResult.value = result.ok ? { ok: true, text: '追平完成' } : { ok: false, text: result.error ?? '追平失败' }
  } catch (e) {
    lastResult.value = { ok: false, text: e instanceof Error ? e.message : String(e) }
  } finally {
    busy.value = false
  }
}

onActivated(() => {
  cfg.value = session.getConfig()
  selectedTables.value = [...(cfg.value.tableFill.manualSelectedTables || [])]
  manualDepth.value = cfg.value.tableFill.manualUpdateContextDepth
  manualBatch.value = cfg.value.tableFill.manualUpdateBatchSize
})
</script>

<template>
  <div class="mf-page">
    <div class="mf-left">
    <section class="mf-card">
      <header class="mf-card__head">
        <div class="mf-card__title">
          <i class="fa-solid fa-chart-line mf-card__icon"></i>
          <span>更新状态</span>
        </div>
        <span class="mf-badge" :class="unrecordedCount > 0 ? 'mf-badge--warn' : 'mf-badge--ok'">
          {{ unrecordedCount > 0 ? `${unrecordedCount} 层待总结` : '已同步' }}
        </span>
      </header>
      <div class="mf-card__body">
        <div class="mf-stats">
          <div class="mf-stat">
            <div class="mf-stat__num">{{ aiFloorCount }}</div>
            <div class="mf-stat__label">AI 回复层</div>
          </div>
          <div class="mf-stat">
            <div class="mf-stat__num">{{ summarizedAiCount }}</div>
            <div class="mf-stat__label">已总结</div>
          </div>
          <div class="mf-stat">
            <div class="mf-stat__num">{{ unrecordedCount }}</div>
            <div class="mf-stat__label">未总结</div>
          </div>
        </div>

        <p class="mf-field__hint">checkpoint：{{ lastSummarized != null ? `已总结至消息 ${lastSummarized}` : '无' }}</p>

        <div class="mf-table-wrap">
          <table class="mf-table">
            <thead>
              <tr>
                <th>表格</th>
                <th>纳入</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="availableTables.length === 0">
                <td colspan="2" class="mf-table__empty">暂无可用表格</td>
              </tr>
              <tr v-for="t in availableTables" :key="t.name">
                <td class="mf-table__name">
                  <span class="mf-table__display">{{ t.displayName }}</span>
                  <span class="mf-table__raw">{{ t.name }}</span>
                </td>
                <td>
                  <label class="mf-check">
                    <input type="checkbox" :value="t.name" v-model="selectedTables" @change="saveSelection" />
                    <span></span>
                  </label>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
    </div>
    <div class="mf-right">
    <section class="mf-card">
      <header class="mf-card__head">
        <div class="mf-card__title">
          <i class="fa-solid fa-sliders mf-card__icon"></i>
          <span>手动填表</span>
        </div>
        <div class="mf-card__actions">
          <button class="mf-btn mf-btn--text" type="button" @click="selectAllTables">全选</button>
          <button class="mf-btn mf-btn--text" type="button" @click="selectNoTables">清空</button>
        </div>
      </header>
      <div class="mf-card__body">
        <div class="mf-field">
          <label class="mf-field__label">本次填表同时更新纪要表</label>
          <label class="mf-switch">
            <input type="checkbox" v-model="includeChronicle" />
            <span class="mf-switch__track"></span>
          </label>
          <p class="mf-field__hint">关闭则本次只更新数据表，不生成/更新纪要。</p>
        </div>

        <div class="mf-grid-2">
          <div class="mf-field">
            <label class="mf-field__label">参考最近 N 轮对话</label>
            <input class="cn-input cn-input--nospin" type="number" min="0" max="50" step="1"
              v-model="manualDepthInput" @change="saveManualDepth" />
            <p class="mf-field__hint">给 AI 看最近多少轮对话作为上下文。</p>
          </div>
          <div class="mf-field">
            <label class="mf-field__label">一次处理 N 条消息</label>
            <input class="cn-input cn-input--nospin" type="number" min="1" max="50" step="1"
              v-model="manualBatchInput" @change="saveManualBatch" />
            <p class="mf-field__hint">把多少条消息拼成一次填表请求。</p>
          </div>
        </div>

        <div class="mf-field">
          <label class="mf-field__label">额外提示</label>
          <textarea class="cn-input cn-textarea" v-model="extraHint" placeholder="给 AI 的额外填表要求，如'重点更新好感度'"></textarea>
        </div>

        <p class="mf-field__hint">预计处理范围：{{ expectedRange }}</p>

        <div class="mf-actions">
          <button class="mf-btn mf-btn--primary" type="button" :disabled="busy || selectedTables.length === 0" @click="runRefill">
            <i class="fa-solid fa-pen-to-square"></i> {{ busy ? '填表中...' : '执行手动填表' }}
          </button>
          <button class="mf-btn mf-btn--secondary" type="button" :disabled="busy" @click="runCatchUp">
            <i class="fa-solid fa-wand-magic-sparkles"></i> {{ busy ? '追平中...' : '追平未总结楼层' }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="busy || lastResult" class="mf-card">
      <header class="mf-card__head">
        <div class="mf-card__title">
          <i class="fa-solid fa-circle-notch mf-card__icon" :class="busy ? 'mf-icon--spin' : ''"></i>
          <span>更新情况</span>
        </div>
      </header>
      <div class="mf-card__body">
        <template v-if="busy">
          <div class="mf-steps">
            <template v-for="(s, i) in steps" :key="s.label">
              <div class="mf-step" :class="{ 'mf-step--active': s.active, 'mf-step--done': s.done }">
                <div class="mf-step__dot">
                  <i v-if="s.done" class="fa-solid fa-check"></i>
                  <span v-else>{{ i + 1 }}</span>
                </div>
                <span class="mf-step__label">{{ s.label }}</span>
              </div>
              <div v-if="i < steps.length - 1" class="mf-step__line" :class="{ 'mf-step__line--done': s.done }"></div>
            </template>
          </div>
          <div class="mf-progress">
            <div class="mf-progress__bar" :style="{ width: progressPercent + '%' }"></div>
          </div>
          <div class="mf-progress__meta">
            <span v-if="totalBuckets > 0">批次 {{ currentBucket }}/{{ totalBuckets }}</span>
            <span v-if="attempt > 0">第 {{ attempt }}/{{ maxRetries }} 次尝试</span>
            <span v-if="errorMsg" class="mf-progress__error">{{ errorMsg }}</span>
          </div>
        </template>
        <div v-else-if="lastResult" class="mf-result" :class="lastResult.ok ? 'mf-result--ok' : 'mf-result--err'">
          <i :class="lastResult.ok ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-exclamation'"></i>
          <span>{{ lastResult.text }}</span>
        </div>
      </div>
    </section>
    </div>
  </div>
</template>
