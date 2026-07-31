<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated } from 'vue'
import { getSession } from '@core/session'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import { syncToWorldbook } from '@core/worldbook-sync'
import toast from '@ui/toast'
import confirm from '@ui/dialog'

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
const cellEditEls = new Map<string, HTMLElement>()

const chronicleDef = computed(() => session.getChronicleTableDef())
const keyColName = computed(() => chronicleDef.value.columns.find((c) => c.role === 'key')?.name)
const fields = computed(() =>
  chronicleDef.value.columns.map((c) => ({
    key: c.name,
    label: c.displayName || c.name,
    full: c.role === 'summary' || c.role === 'keyDialogue'
  }))
)

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

const hasSession = computed(
  () => session.listTables().filter((n) => !n.startsWith('sqlite_')).length > 0
)
const chronicleEnabled = computed(() => session.getConfig().chronicleGenEnabled)

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

onMounted(refresh)
onActivated(refresh)
</script>

<template>
  <div class="chronicle-page">
    <div class="chronicle-toolbar">
      <input class="cn-input chronicle-toolbar__search" v-model="keyword" placeholder="搜索纪要…" />
      <span class="chronicle-toolbar__count">共 {{ rows.length }} 条</span>
      <button class="cn-btn cn-btn--sm" @click="refresh">
        <i class="fa-solid fa-rotate"></i>
        刷新
      </button>
      <button class="cn-btn cn-btn--sm" @click="addRow">
        <i class="fa-solid fa-plus"></i>
        添加条目
      </button>
    </div>

    <div v-if="!chatActive" class="cn-empty">未检测到聊天，请先在酒馆中打开一个对话</div>
    <div v-else-if="!hasSession" class="cn-empty">当前会话未载入表格</div>
    <template v-else>
      <div v-if="!chronicleEnabled" class="chronicle-gen-off-tip">
        <i class="fa-solid fa-circle-exclamation"></i>
        <span>纪要生成已关闭，新交互不会自动产生纪要。下方仍可查看已有纪要。</span>
      </div>
      <div v-if="filtered.length === 0" class="cn-empty">
        {{ rows.length === 0 ? '暂无纪要' : '无匹配结果' }}
      </div>

    <div v-else class="chronicle-list">
      <TransitionGroup name="cn-list">
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
                <button class="cn-btn cn-btn--sm cn-btn--primary" @click="saveEdit">保存</button>
                <button class="cn-btn cn-btn--sm" @click="cancelEdit">取消</button>
              </div>
            </template>
            <template v-else>
              <div class="cn-space">
                <button class="cn-btn cn-btn--sm" @click="startEdit(row)">
                  <i class="fa-solid fa-pen"></i>
                  修改
                </button>
                <button class="cn-btn cn-btn--sm cn-btn--text" title="删除" @click="deleteRow(row)">
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
        </div>
      </TransitionGroup>
    </div>
    </template>
  </div>
</template>
