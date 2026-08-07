<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated } from 'vue'
import { getSession } from '@core/session'
import { CHRONICLE_TABLE_NAME, CHRONICLE_COLUMNS } from '@shared/constants/chronicle'
import { syncToWorldbook } from '@core/worldbook-sync'
import toast from '@ui/toast'
import { useFillStatusStore } from '@ui/stores/fill-status'
import confirm from '@ui/dialog'
import CNTabs from '@ui/components/CNTabs.vue'
import { detectLastSummarizedAiFloor } from '@core/table/fill-orchestrator'
import { validateRowRequired } from '@shared/table-validation'
import type { FillProgressFn } from '@core/table/retry-loop'

interface RowData {
  __rowid__: number
  [k: string]: unknown
}

const session = getSession()
const rows = ref<RowData[]>([])
const chatActive = ref(false)
const keyword = ref('')
const editingRowid = ref<number | null>(null)
const editSnapshot = ref<RowData | null>(null)
const saving = ref(false)
const cellEditEls = new Map<string, HTMLElement>()

const pageTab = ref<'list' | 'fill'>('list')
const pageTabs = [
  { key: 'list', label: '纪要', icon: 'fa-clock-rotate-left' },
  { key: 'fill', label: '手动填纪要', icon: 'fa-pen-to-square' }
]
const pageTabValue = computed({
  get: () => pageTab.value,
  set: (v: string) => {
    pageTab.value = v as 'list' | 'fill'
  }
})

const chronicleDef = computed(() => session.getChronicleTableDef())
const keyColName = computed(() => CHRONICLE_COLUMNS.key)
const fields = computed(() =>
  chronicleDef.value.columns.map((c) => ({
    key: c.name,
    label: c.displayName || c.name,
    constraints: c.constraints,
    full: c.name === CHRONICLE_COLUMNS.summary || c.name === CHRONICLE_COLUMNS.importantWord,
    isImportantWord: c.name === CHRONICLE_COLUMNS.importantWord
  }))
)

function parseImportantWord(val: unknown): { label: string; value: string }[] {
  if (typeof val !== 'string' || !val.trim()) return []
  return val.split('\n').map((line) => {
    const idx = line.search(/[:：]/)
    if (idx < 0) return { label: '', value: line.trim() }
    return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() }
  }).filter((p) => p.label || p.value)
}

function refresh() {
  chatActive.value = session.isChatActive()
  try {
    const result = session.getTableRowsWithRowid(CHRONICLE_TABLE_NAME)
    const first = result[0]
    rows.value = (first?.rows ?? []) as unknown as RowData[]
  } catch {
    rows.value = []
  }
}

let draftCounter = -1

const hasSession = computed(() => session.listTables().includes(CHRONICLE_TABLE_NAME))
const chronicleEnabled = computed(() => session.getConfig().chronicleFill.autoFillTrigger !== 'off')

function startEdit(row: RowData) {
  editingRowid.value = row.__rowid__
  editSnapshot.value = { ...row }
  cellEditEls.clear()
}

function registerCellEl(col: string, el: Element | null): void {
  const rowid = editingRowid.value
  if (rowid == null || el == null) return
  if (!(el instanceof HTMLElement)) return
  if (!cellEditEls.has(col)) {
    cellEditEls.set(col, el)
    const row = rows.value.find((r) => r.__rowid__ === rowid)
    el.innerText = row ? String(row[col] ?? '') : ''
  }
}

function cancelEdit() {
  const row = rows.value.find((r) => r.__rowid__ === editingRowid.value)
  if (row && row.__rowid__ < 0) {
    rows.value = rows.value.filter((r) => r.__rowid__ !== row.__rowid__)
  }
  editingRowid.value = null
  editSnapshot.value = null
  cellEditEls.clear()
}

function saveEdit() {
  if (editingRowid.value == null) return
  if (saving.value) return
  const row = rows.value.find((r) => r.__rowid__ === editingRowid.value)
  if (!row) {
    editingRowid.value = null
    return
  }
  const collected: Record<string, string> = {}
  for (const f of fields.value) {
    const el = cellEditEls.get(f.key)
    collected[f.key] = el ? el.innerText : String(row[f.key] ?? '')
  }
  const requiredError = validateRowRequired(chronicleDef.value.columns, collected)
  if (requiredError) {
    toast.error(requiredError)
    return
  }
  saving.value = true
  void session.runWrite(async () => {
    try {
      if (row.__rowid__ < 0) {
        const values: Record<string, string> = {}
        for (const f of fields.value) {
          values[f.key] = String(collected[f.key] ?? '')
        }
        session.insertRow(CHRONICLE_TABLE_NAME, values)
      } else {
        for (const f of fields.value) {
          const newVal = String(collected[f.key] ?? '')
          const oldVal = editSnapshot.value ? String(editSnapshot.value[f.key] ?? '') : ''
          if (newVal !== oldVal) {
            session.updateCell(CHRONICLE_TABLE_NAME, editingRowid.value!, f.key, newVal)
          }
        }
      }
      toast.success('已保存')
      await persistChanges()
      editingRowid.value = null
      editSnapshot.value = null
      cellEditEls.clear()
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      saving.value = false
    }
  })
}

async function persistChanges() {
  const chat = session.chat.getChat()
  const lastMsgId = chat.length - 1
  if (lastMsgId >= 0) {
    session.saveToChat(lastMsgId)
  }
  await syncToWorldbook(session)
  try {
    await session.chat.saveChat()
  } catch {}
}

function addRow() {
  const draft: RowData = { __rowid__: draftCounter-- }
  for (const f of fields.value) {
    draft[f.key] = ''
  }
  rows.value.push(draft)
  startEdit(draft)
}

async function deleteRow(row: RowData) {
  const keyText = keyColName.value ? String(row[keyColName.value] ?? '') : ''
  const ok = await confirm('删除确认', `确认删除纪要「${keyText}」？`, '删除', true)
  if (!ok) return
  await session.runWrite(async () => {
    try {
      session.deleteRow(CHRONICLE_TABLE_NAME, row.__rowid__)
      rows.value = rows.value.filter((r) => r.__rowid__ !== row.__rowid__)
      toast.success(`已删除 ${keyText}`)
      await persistChanges()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  })
}

const filtered = ref<RowData[]>([])
function applyFilter() {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) {
    filtered.value = rows.value
    return
  }
  filtered.value = rows.value.filter((r) => JSON.stringify(r).toLowerCase().includes(kw))
}

watch([rows, keyword], applyFilter, { immediate: true })

const manualDepth = ref<number | null>(session.getConfig().chronicleFill.manualUpdateContextDepth)
const manualBatch = ref<number | null>(session.getConfig().chronicleFill.manualUpdateBatchSize)
const extraHint = ref('')
const busy = ref(false)
const fillStore = useFillStatusStore()
const chronicleBusy = computed(() => busy.value || fillStore.chronicleActive)

function clampInt(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(raw)))
}
function defaultInput(r: { value: number | null }, fallback: number) {
  return computed({
    get: () => (r.value === null ? String(fallback) : String(r.value)),
    set: (v: string) => { r.value = v === '' ? null : Number(v) }
  })
}
const manualDepthInput = defaultInput(manualDepth, session.getConfig().chronicleFill.contextDepth)
const manualBatchInput = defaultInput(manualBatch, session.getConfig().chronicleFill.batchSize)

const aiFloorCount = computed(() => session.chat.getChat().filter((m) => !m.is_user && !m.is_system).length)
const lastSummarized = computed(() => {
  void fillStore.progressTick
  return detectLastSummarizedAiFloor(session, 'chronicle')
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
  const depth = manualDepth.value ?? session.getConfig().chronicleFill.contextDepth
  const aiFloors: number[] = []
  for (let i = 0; i < chat.length; i++) {
    if (!chat[i]!.is_user && !chat[i]!.is_system) aiFloors.push(i)
  }
  if (aiFloors.length === 0) return '无 AI 楼层'
  const takeCount = depth > 0 ? Math.min(depth, aiFloors.length) : aiFloors.length
  return `AI第 ${aiFloors.length - takeCount + 1}~${aiFloors.length} 层（共 ${takeCount} 个 AI 楼层）`
})

function saveManualDepth() {
  const c = session.getConfig()
  const v = manualDepth.value
  c.chronicleFill.manualUpdateContextDepth = v === null ? null : clampInt(v, 0, 50, 0)
  manualDepth.value = c.chronicleFill.manualUpdateContextDepth
  session.saveConfig(c)
}
function saveManualBatch() {
  const c = session.getConfig()
  const v = manualBatch.value
  c.chronicleFill.manualUpdateBatchSize = v === null ? null : clampInt(v, 1, 50, 1)
  manualBatch.value = c.chronicleFill.manualUpdateBatchSize
  session.saveConfig(c)
}

function aiFloorSeqOf(msgIndex: number): number {
  const chat = session.chat.getChat()
  let seq = 0
  for (let i = 0; i <= msgIndex && i < chat.length; i++) {
    const m = chat[i]
    if (m && !m.is_user && !m.is_system) seq++
  }
  return seq
}

function computeChronicleCatchUpRange() {
  const chat = session.chat.getChat()
  const aiFloors: number[] = []
  for (let i = 0; i < chat.length; i++) {
    const m = chat[i]
    if (m && !m.is_user && !m.is_system) aiFloors.push(i)
  }
  if (aiFloors.length === 0) return null
  const baseLast = detectLastSummarizedAiFloor(session, 'chronicle')
  const fromIdx = baseLast != null ? baseLast + 1 : 0
  const toIdx = aiFloors[aiFloors.length - 1]!
  if (fromIdx > toIdx) return null
  const fromSeq = aiFloorSeqOf(fromIdx)
  const toSeq = aiFloorSeqOf(toIdx)
  const aiCount = aiFloors.filter((idx) => idx >= fromIdx && idx <= toIdx).length
  const batch = Math.max(1, manualBatch.value ?? session.getConfig().chronicleFill.batchSize)
  const totalBuckets = Math.max(1, Math.ceil(aiCount / batch))
  return { fromIdx, toIdx, fromSeq, toSeq, aiCount, totalBuckets }
}

function makeProgressUpdater(prog: ReturnType<typeof toast.progress>, prefix: string): FillProgressFn {
  return (phase, detail) => {
    const b = detail?.currentBucket
    const n = detail?.totalBuckets
    const batchStr = b && n ? `第${b}/${n}批 · ` : ''
    const phaseText = phase === 'calling_ai' ? '调用AI…'
      : phase === 'parsing' ? '解析中'
      : phase === 'saving' ? '保存中'
      : phase === 'retry' ? `重试(第${detail?.attempt ?? '?'}次)`
      : phase === 'error' ? '出错'
      : ''
    if (phaseText) prog.update(`${prefix}${batchStr}${phaseText}`)
  }
}

async function runChronicleFill() {
  if (busy.value) return
  const confirmed = await confirm('手动生成纪要', '是否手动生成纪要？', '确认执行')
  if (!confirmed) return
  busy.value = true
  const prog = toast.progress('生成纪要 · 调用AI…')
  try {
    const result = await session.runManualChronicleFill({
      contextDepth: manualDepth.value ?? undefined,
      batchSize: manualBatch.value ?? undefined,
      extraHint: extraHint.value.trim() || undefined,
      fillCfgSource: 'chronicle',
      onProgress: makeProgressUpdater(prog, '生成纪要 · '),
      signal: prog.abortSignal,
    })
    if (result.ok) { prog.done(); refresh() }
    else prog.fail(result.error ?? '生成失败')
  } catch (e) {
    prog.fail(e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = false
  }
}

async function runChronicleCatchUp() {
  if (busy.value) return
  const range = computeChronicleCatchUpRange()
  if (!range) {
    toast.info('当前已同步，无需追平')
    return
  }
  const rangeText = `将从第 ${range.fromSeq} 层追平至第 ${range.toSeq} 层（共 ${range.aiCount} 个 AI 楼层，约 ${range.totalBuckets} 批）`
  const confirmed = await confirm('追平未总结楼层', rangeText, '确认追平')
  if (!confirmed) return
  busy.value = true
  const prefix = `追平 第${range.fromSeq}→${range.toSeq}层 · `
  const prog = toast.progress(`${prefix}调用AI…`)
  try {
    const result = await session.runManualChronicleCatchUp({
      batchSize: manualBatch.value ?? undefined,
      extraHint: extraHint.value.trim() || undefined,
      fillCfgSource: 'chronicle',
      onProgress: makeProgressUpdater(prog, prefix),
      signal: prog.abortSignal,
    })
    if (result.ok) { prog.done(); refresh() }
    else prog.fail(result.error ?? '追平失败')
  } catch (e) {
    prog.fail(e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
onActivated(() => {
  refresh()
  manualDepth.value = session.getConfig().chronicleFill.manualUpdateContextDepth
  manualBatch.value = session.getConfig().chronicleFill.manualUpdateBatchSize
})
</script>

<template>
  <div class="chronicle-page">
    <div v-if="!chatActive" class="cn-empty">未检测到聊天，请先在酒馆中打开一个对话</div>
    <template v-else>
      <CNTabs level="l1" :items="pageTabs" v-model="pageTabValue" />

      <div v-if="pageTab === 'fill'" class="mf-page">
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
            </div>
          </section>
        </div>
        <div class="mf-right">
          <section class="mf-card">
            <header class="mf-card__head">
              <div class="mf-card__title">
                <i class="fa-solid fa-sliders mf-card__icon"></i>
                <span>手动填纪要</span>
              </div>
            </header>
            <div class="mf-card__body">
              <div class="mf-grid-2">
                <div class="mf-field">
                  <label class="mf-field__label">处理最近 N 个 AI 楼层</label>
                  <input class="cn-input cn-input--nospin" type="number" min="0" max="50" step="1" v-model="manualDepthInput" @change="saveManualDepth" />
                  <p class="mf-field__hint">处理最近多少个 AI 楼层。</p>
                </div>
                <div class="mf-field">
                  <label class="mf-field__label">每批处理 N 个 AI 楼层</label>
                  <input class="cn-input cn-input--nospin" type="number" min="1" max="50" step="1" v-model="manualBatchInput" @change="saveManualBatch" />
                  <p class="mf-field__hint">每批处理多少个 AI 楼层。</p>
                </div>
              </div>
              <div class="mf-field">
                <label class="mf-field__label">额外提示</label>
                <textarea class="cn-input cn-textarea" v-model="extraHint" placeholder="给 AI 的额外纪要生成要求"></textarea>
              </div>
              <p class="mf-field__hint">预计处理范围：{{ expectedRange }}</p>
              <div class="mf-actions">
                <button class="mf-btn mf-btn--primary" type="button" :disabled="chronicleBusy" @click="runChronicleFill">
                  <i class="fa-solid" :class="chronicleBusy ? 'fa-spinner fa-spin' : 'fa-pen-to-square'"></i> {{ chronicleBusy ? '生成中...' : '执行手动填纪要' }}
                </button>
                <button class="mf-btn mf-btn--secondary" type="button" :disabled="chronicleBusy" @click="runChronicleCatchUp">
                  <i class="fa-solid" :class="chronicleBusy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'"></i> {{ chronicleBusy ? '追平中...' : '追平未总结楼层' }}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <template v-else>
        <div class="chronicle-toolbar">
          <input class="cn-input chronicle-toolbar__search" v-model="keyword" placeholder="搜索纪要…" />
          <span class="chronicle-toolbar__count">共 {{ rows.length }} 条</span>
          <button class="cn-btn cn-btn--sm" @click="refresh">
            <i class="fa-solid fa-rotate"></i>
            刷新
          </button>
          <button class="cn-btn cn-btn--sm" :disabled="chronicleBusy" @click="addRow">
            <i class="fa-solid fa-plus"></i>
            添加条目
          </button>
        </div>
        <div v-if="!hasSession" class="cn-empty">当前会话未载入表格</div>
        <template v-else>
          <div v-if="!chronicleEnabled" class="chronicle-gen-off-tip">
            <i class="fa-solid fa-circle-exclamation"></i>
            <span>纪要生成已关闭，新交互不会自动产生纪要。下方仍可查看已有纪要。</span>
          </div>
          <div v-if="filtered.length === 0" class="cn-empty">
            {{ rows.length === 0 ? '暂无纪要' : '无匹配结果' }}
          </div>

          <div v-else class="chronicle-list">
            <div
              v-for="row in filtered"
              :key="row.__rowid__"
              class="cn-card chronicle-item"
              :class="{ 'chronicle-item--editing': row.__rowid__ === editingRowid }"
            >
              <div class="cn-card__head">
                <span class="chronicle-item__key">{{ keyColName ? (row[keyColName] ?? '') : '' }}</span>
                <template v-if="row.__rowid__ === editingRowid">
                  <div class="cn-space">
                    <button class="cn-btn cn-btn--sm cn-btn--primary" :disabled="chronicleBusy || saving" @click="saveEdit">保存</button>
                    <button class="cn-btn cn-btn--sm" :disabled="saving" @click="cancelEdit">取消</button>
                  </div>
                </template>
                <template v-else>
                  <div class="cn-space">
                    <button class="cn-btn cn-btn--sm" @click="startEdit(row)">
                      <i class="fa-solid fa-pen"></i>
                      修改
                    </button>
                    <button class="cn-btn cn-btn--sm cn-btn--text" title="删除" :disabled="chronicleBusy" @click="deleteRow(row)">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </template>
              </div>
              <div class="cn-card__body">
                <div class="chronicle-fields">
                  <div v-for="f in fields.filter((x) => !x.full)" :key="f.key" class="chronicle-field">
                    <label class="chronicle-field__label">{{ f.label }}</label>
                    <div
                      v-if="row.__rowid__ === editingRowid"
                      class="cell-edit chronicle-field__value"
                      contenteditable="true"
                      :ref="(el) => registerCellEl(f.key, el)"
                    ></div>
                    <div v-else class="cell-edit chronicle-field__value">
                      {{ row[f.key] ?? '' }}
                    </div>
                  </div>
                </div>
                <div
                  v-for="f in fields.filter((x) => x.full)"
                  :key="f.key"
                  class="chronicle-field chronicle-field--full"
                >
                  <label class="chronicle-field__label">
                    {{ f.label }}
                  </label>
                  <div
                    v-if="row.__rowid__ === editingRowid"
                    class="cell-edit chronicle-field__value"
                    contenteditable="true"
                    :ref="(el) => registerCellEl(f.key, el)"
                  ></div>
                  <div v-else-if="f.isImportantWord" class="chronicle-iw-list">
                    <template v-if="parseImportantWord(row[f.key]).length > 0">
                      <div v-for="(p, i) in parseImportantWord(row[f.key])" :key="i" class="chronicle-iw-item">
                        <span class="chronicle-iw-item__label">{{ p.label }}</span>
                        <span class="chronicle-iw-item__value">{{ p.value }}</span>
                      </div>
                    </template>
                    <div v-else class="cell-edit chronicle-field__value">{{ row[f.key] ?? '' }}</div>
                  </div>
                  <div v-else class="cell-edit chronicle-field__value">
                    {{ row[f.key] ?? '' }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
