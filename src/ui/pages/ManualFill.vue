<script setup lang="ts">
import { ref, computed, onActivated } from 'vue'
import { getSession } from '@core/session'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import { detectLastSummarizedAiFloor, detectLastUpdatedAiFloorForTable } from '@core/table/fill-orchestrator'
import type { FillProgressFn } from '@core/table/retry-loop'
import type { CranialNerveConfig } from '@shared/types/config'
import confirm from '@ui/dialog'
import toast from '@ui/toast'
import { useFillStatusStore } from '@ui/stores/fill-status'

const session = getSession()
const cfg = ref<CranialNerveConfig>(session.getConfig())

const refreshTick = ref(0)
const availableTables = computed(() => {
  void refreshTick.value
  void fillStore.progressTick
  const names = session.listTables().filter((n) => !n.startsWith('sqlite_') && n !== CHRONICLE_TABLE_NAME)
  return names.map((n) => {
    const def = session.getTableDef(n)
    const lastMsg = detectLastUpdatedAiFloorForTable(session, n)
    const aiSeq = lastMsg != null ? aiFloorSeqOf(lastMsg) : 0
    return { name: n, displayName: def?.displayName || n, lastMsg, aiSeq }
  })
})
const selectedTables = ref<string[]>([...(cfg.value.tableFill.manualSelectedTables || [])])
const manualDepth = ref<number | null>(cfg.value.tableFill.manualUpdateContextDepth)
const manualBatch = ref<number | null>(cfg.value.tableFill.manualUpdateBatchSize)
const extraHint = ref('')
const busy = ref(false)
const fillStore = useFillStatusStore()
const tableBusy = computed(() => busy.value || fillStore.tableActive)

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
const lastSummarized = computed(() => {
  void fillStore.progressTick
  return detectLastSummarizedAiFloor(session)
})
const summarizedAiCount = computed(() => {
  const last = lastSummarized.value
  if (last == null) return 0
  return session.chat.getChat().slice(0, last + 1).filter((m) => !m.is_user && !m.is_system).length
})
const unrecordedCount = computed(() => Math.max(0, aiFloorCount.value - summarizedAiCount.value))
const expectedRange = computed(() => {
  void fillStore.progressTick
  const chat = session.chat.getChat()
  const depth = manualDepth.value ?? cfg.value.tableFill.contextDepth
  const aiFloors: number[] = []
  for (let i = 0; i < chat.length; i++) {
    if (!chat[i]!.is_user && !chat[i]!.is_system) aiFloors.push(i)
  }
  if (aiFloors.length === 0) return '无 AI 楼层'
  const takeCount = depth > 0 ? Math.min(depth, aiFloors.length) : aiFloors.length
  return `AI第 ${aiFloors.length - takeCount + 1}~${aiFloors.length} 层（共 ${takeCount} 个 AI 楼层）`
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

const includeChronicle = computed({
  get: () => cfg.value.tableFill.manualIncludeChronicle,
  set: (v: boolean) => { cfg.value.tableFill.manualIncludeChronicle = v; session.saveConfig(cfg.value) }
})

function aiFloorSeqOf(msgIndex: number): number {
  const chat = session.chat.getChat()
  let seq = 0
  for (let i = 0; i <= msgIndex && i < chat.length; i++) {
    const m = chat[i]
    if (m && !m.is_user && !m.is_system) seq++
  }
  return seq
}

function firstAiSeqAt(fromIdx: number): number {
  const chat = session.chat.getChat()
  for (let i = fromIdx; i < chat.length; i++) {
    const m = chat[i]
    if (m && !m.is_user && !m.is_system) return aiFloorSeqOf(i)
  }
  return 0
}

function computeCatchUpRange() {
  const chat = session.chat.getChat()
  const aiFloors: number[] = []
  for (let i = 0; i < chat.length; i++) {
    const m = chat[i]
    if (m && !m.is_user && !m.is_system) aiFloors.push(i)
  }
  if (aiFloors.length === 0) return null
  const toIdx = aiFloors[aiFloors.length - 1]!
  const toSeq = aiFloorSeqOf(toIdx)
  if (!includeChronicle.value) {
    const t = detectLastSummarizedAiFloor(session, 'table')
    const fromIdx = t != null && t >= 0 ? t + 1 : 0
    if (fromIdx > toIdx) return null
    const aiCount = aiFloors.filter((idx) => idx >= fromIdx && idx <= toIdx).length
    const batch = Math.max(1, manualBatch.value ?? cfg.value.tableFill.batchSize)
    const totalBuckets = Math.max(1, Math.ceil(aiCount / batch))
    return { fromIdx, toIdx, fromSeq: firstAiSeqAt(fromIdx), toSeq, aiCount, totalBuckets }
  }
  const t = detectLastSummarizedAiFloor(session, 'table')
  const c = detectLastSummarizedAiFloor(session, 'chronicle')
  const tableFrom = t != null && t >= 0 ? t + 1 : 0
  const chronicleFrom = c != null && c >= 0 ? c + 1 : 0
  if (tableFrom > toIdx && chronicleFrom > toIdx) return null
  const tableAiCount = aiFloors.filter((idx) => idx >= tableFrom && idx <= toIdx).length
  const chronicleAiCount = aiFloors.filter((idx) => idx >= chronicleFrom && idx <= toIdx).length
  const batch = Math.max(1, manualBatch.value ?? cfg.value.tableFill.batchSize)
  const tableBuckets = Math.max(1, Math.ceil(tableAiCount / batch))
  const chronicleBuckets = Math.max(1, Math.ceil(chronicleAiCount / batch))
  return {
    fromIdx: Math.min(tableFrom, chronicleFrom),
    toIdx,
    fromSeq: firstAiSeqAt(Math.min(tableFrom, chronicleFrom)),
    toSeq,
    aiCount: Math.max(tableAiCount, chronicleAiCount),
    totalBuckets: tableBuckets + chronicleBuckets,
    tableFrom,
    chronicleFrom,
    tableFromSeq: firstAiSeqAt(tableFrom),
    chronicleFromSeq: firstAiSeqAt(chronicleFrom),
    tableAiCount,
    chronicleAiCount
  }
}

function makeProgressUpdater(prog: ReturnType<typeof toast.progress>, prefix: string): FillProgressFn {
  return (phase, detail) => {
    const b = detail?.currentBucket
    const n = detail?.totalBuckets
    const batchStr = b && n ? `第${b}/${n}批 · ` : ''
    const legText = detail?.leg === 'chronicle' ? '纪要 · ' : detail?.leg === 'table' ? '表格 · ' : ''
    const phaseText = phase === 'calling_ai' ? '调用AI…'
      : phase === 'parsing' ? '解析中'
      : phase === 'saving' ? '保存中'
      : phase === 'retry' ? `重试(第${detail?.attempt ?? '?'}次)`
      : phase === 'error' ? '出错'
      : ''
    if (phaseText) prog.update(`${prefix}${legText}${batchStr}${phaseText}`)
  }
}

async function runRefill() {
  if (busy.value || selectedTables.value.length === 0) return
  const confirmed = await confirm('执行手动填表', '是否执行手动填表？若相关层数有数据，则数据会丢失。', '确认执行', true)
  if (!confirmed) return
  busy.value = true
  const prog = toast.progress('手动填表 · 调用AI…')
  try {
    const result = await session.runManualRefill({
      targetTables: selectedTables.value,
      contextDepth: manualDepth.value ?? undefined,
      batchSize: manualBatch.value ?? undefined,
      extraHint: extraHint.value.trim() || undefined,
      runMode: includeChronicle.value ? 'merged' : undefined,
      fillCfgSource: 'table',
      onProgress: makeProgressUpdater(prog, '手动填表 · '),
      signal: prog.abortSignal,
    })
    if (result.ok) {
      prog.done()
      refreshTick.value++
    }
    else prog.fail(result.error ?? '重填失败')
  } catch (e) {
    prog.fail(e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = false
  }
}

async function runCatchUp() {
  if (busy.value) return
  const range = computeCatchUpRange()
  if (!range) {
    toast.info('当前已同步，无需追平')
    return
  }
  const merged = includeChronicle.value
  const rangeText = merged
    ? `表格：从第 ${range.tableFromSeq} 层追平至第 ${range.toSeq} 层（${range.tableAiCount} 个 AI 楼层）；纪要：从第 ${range.chronicleFromSeq} 层追平至第 ${range.toSeq} 层（${range.chronicleAiCount} 个 AI 楼层，约 ${range.totalBuckets} 批）`
    : `将从第 ${range.fromSeq} 层追平至第 ${range.toSeq} 层（共 ${range.aiCount} 个 AI 楼层，约 ${range.totalBuckets} 批）`
  const confirmed = await confirm('追平未更新楼层', rangeText, '确认追平')
  if (!confirmed) return
  busy.value = true
  const prefix = merged ? '追平 · ' : `追平 第${range.fromSeq}→${range.toSeq}层 · `
  const prog = toast.progress(`${prefix}调用AI…`)
  try {
    const result = await session.runManualCatchUp({
      targetTables: selectedTables.value.length > 0 ? selectedTables.value : undefined,
      batchSize: manualBatch.value ?? undefined,
      extraHint: extraHint.value.trim() || undefined,
      runMode: merged ? 'merged' : undefined,
      fillCfgSource: 'table',
      onProgress: makeProgressUpdater(prog, prefix),
      signal: prog.abortSignal,
    })
    if (result.ok) prog.done()
    else prog.fail(result.error ?? '追平失败')
  } catch (e) {
    prog.fail(e instanceof Error ? e.message : String(e))
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
          {{ unrecordedCount > 0 ? `${unrecordedCount} 层待更新` : '已同步' }}
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
            <div class="mf-stat__label">已更新</div>
          </div>
          <div class="mf-stat">
            <div class="mf-stat__num">{{ unrecordedCount }}</div>
            <div class="mf-stat__label">未更新</div>
          </div>
        </div>

        <p class="mf-field__hint">checkpoint：{{ lastSummarized != null ? `已更新至消息 ${lastSummarized}` : '无' }}</p>

        <div class="mf-table-wrap">
          <table class="mf-table">
            <thead>
              <tr>
                <th>表格</th>
                <th>更新至</th>
                <th>纳入</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="availableTables.length === 0">
                <td colspan="3" class="mf-table__empty">暂无可用表格</td>
              </tr>
              <tr v-for="t in availableTables" :key="t.name">
                <td class="mf-table__name">
                  <span class="mf-table__display">{{ t.displayName }}</span>
                  <span class="mf-table__raw">{{ t.name }}</span>
                </td>
                <td class="mf-table__update">{{ t.lastMsg != null ? `AI第${t.aiSeq}层` : '未更新' }}</td>
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
        <div class="mf-grid-2">
          <div class="mf-field">
            <label class="mf-field__label">处理最近 N 个 AI 楼层</label>
            <input class="cn-input cn-input--nospin" type="number" min="0" max="50" step="1"
              v-model="manualDepthInput" @change="saveManualDepth" />
            <p class="mf-field__hint">处理最近多少个 AI 楼层。</p>
          </div>
          <div class="mf-field">
            <label class="mf-field__label">每批处理 N 个 AI 楼层</label>
            <input class="cn-input cn-input--nospin" type="number" min="1" max="50" step="1"
              v-model="manualBatchInput" @change="saveManualBatch" />
            <p class="mf-field__hint">每批处理多少个 AI 楼层。</p>
          </div>
        </div>

        <div class="mf-field">
          <label class="mf-field__label">额外提示</label>
          <textarea class="cn-input cn-textarea" v-model="extraHint" placeholder="给 AI 的额外填表要求，如'重点更新好感度'"></textarea>
        </div>

        <p class="mf-field__hint">预计处理范围：{{ expectedRange }}</p>

        <div class="mf-field">
          <label class="mf-field__label">同时生成纪要</label>
          <label class="cn-switch">
            <input type="checkbox" v-model="includeChronicle" />
            <span class="cn-switch__track"></span>
          </label>
        </div>

        <div class="mf-actions">
          <button class="mf-btn mf-btn--primary" type="button" :disabled="tableBusy || selectedTables.length === 0" @click="runRefill">
            <i class="fa-solid" :class="tableBusy ? 'fa-spinner fa-spin' : 'fa-pen-to-square'"></i> {{ tableBusy ? '填表中...' : '执行手动填表' }}
          </button>
          <button class="mf-btn mf-btn--secondary" type="button" :disabled="tableBusy" @click="runCatchUp">
            <i class="fa-solid" :class="tableBusy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'"></i> {{ tableBusy ? '追平中...' : '追平未更新楼层' }}
          </button>
        </div>
      </div>
    </section>
    </div>
  </div>
</template>
