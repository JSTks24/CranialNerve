<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue'
import { getSession } from '@core/session'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import { syncToWorldbook } from '@core/worldbook-sync'
import toast from '@ui/toast'
import confirm from '@ui/dialog'
import ManualFill from './ManualFill.vue'

interface RowData {
  __rowid__: number
  [k: string]: unknown
}

interface TableInfo {
  name: string
  displayName: string
  columns: string[]
  colNames: Record<string, string>
  rows: RowData[]
}

const session = getSession()
const tables = ref<TableInfo[]>([])
const chatActive = ref(false)
const activeName = ref<string>('')
const pageTab = ref<'tables' | 'fill'>('tables')
const editingRowid = ref<number | null>(null)
const editSnapshot = ref<Record<string, string>>({})
const cellEditEls = new Map<string, HTMLElement>()
let draftCounter = -1

const activeTable = computed(() => tables.value.find((t) => t.name === activeName.value))

function switchTab(name: string) {
  if (editingRowid.value != null) {
    cancelEdit()
  }
  activeName.value = name
}

function refresh() {
  chatActive.value = session.isChatActive()
  const names = session.listTables()
  tables.value = names
    .filter((n) => !n.startsWith('sqlite_') && n !== CHRONICLE_TABLE_NAME)
    .map((name) => {
      const result = session.getTableRowsWithRowid(name)
      const first = result[0]
      const cols = (first?.columns ?? []).filter((c) => c !== '__rowid__')
      const rows = (first?.rows ?? []) as RowData[]
      const def = session.getTableDef(name)
      const colNames: Record<string, string> = {}
      for (const c of def?.columns ?? []) {
        colNames[c.name] = c.displayName
      }
      return { name, displayName: def?.displayName ?? name, columns: cols, colNames, rows }
    })
  if (!tables.value.find((t) => t.name === activeName.value) && tables.value.length > 0) {
    activeName.value = tables.value[0]!.name
  }
}

function fieldValue(row: RowData, col: string): string {
  const v = row[col]
  return v == null ? '' : String(v)
}

function startEdit(row: RowData) {
  if (!activeTable.value) return
  editingRowid.value = row.__rowid__
  const snap: Record<string, string> = {}
  for (const c of activeTable.value.columns) {
    snap[c] = fieldValue(row, c)
  }
  editSnapshot.value = snap
  cellEditEls.clear()
}

function registerCellEl(col: string, el: Element | null): void {
  const rowid = editingRowid.value
  if (rowid == null || el == null) return
  if (!(el instanceof HTMLElement)) return
  if (!cellEditEls.has(col)) {
    cellEditEls.set(col, el)
    const row = activeTable.value?.rows.find((r) => r.__rowid__ === rowid)
    el.innerText = row ? fieldValue(row, col) : ''
  }
}

function cancelEdit() {
  if (!activeTable.value || editingRowid.value == null) return
  const row = activeTable.value.rows.find((r) => r.__rowid__ === editingRowid.value)
  if (row && row.__rowid__ < 0) {
    activeTable.value.rows = activeTable.value.rows.filter((r) => r.__rowid__ !== row.__rowid__)
  }
  editingRowid.value = null
  editSnapshot.value = {}
  cellEditEls.clear()
}

function saveEdit() {
  if (!activeTable.value || editingRowid.value == null) return
  const row = activeTable.value.rows.find((r) => r.__rowid__ === editingRowid.value)
  if (!row) {
    editingRowid.value = null
    return
  }
  const collected: Record<string, string> = {}
  for (const c of activeTable.value.columns) {
    const el = cellEditEls.get(c)
    collected[c] = el ? el.innerText : String(row[c] ?? '')
  }
  void session.runWrite(async () => {
    try {
      if (row.__rowid__ < 0) {
        const values: Record<string, string> = {}
        for (const c of activeTable.value!.columns) {
          values[c] = String(collected[c] ?? '')
        }
        session.insertRow(activeTable.value!.name, values)
      } else {
        for (const c of activeTable.value!.columns) {
          const newVal = String(collected[c] ?? '')
          if (newVal !== editSnapshot.value[c]) {
            session.updateCell(activeTable.value!.name, editingRowid.value!, c, newVal)
          }
        }
      }
      await persistChanges()
      toast.success('已保存')
      editingRowid.value = null
      editSnapshot.value = {}
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

async function deleteRow(row: RowData) {
  if (!activeTable.value) return
  const ok = await confirm('删除确认', '确认删除该行？此操作不可撤销。', '删除', true)
  if (!ok) return
  await session.runWrite(async () => {
    try {
      session.deleteRow(activeTable.value!.name, row.__rowid__)
      if (activeTable.value) {
        activeTable.value.rows = activeTable.value.rows.filter((r) => r.__rowid__ !== row.__rowid__)
      }
      toast.success('已删除')
      await persistChanges()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  })
}

function addRow() {
  if (!activeTable.value) return
  const draft: RowData = { __rowid__: draftCounter-- }
  for (const c of activeTable.value.columns) {
    draft[c] = ''
  }
  activeTable.value.rows.push(draft)
  startEdit(draft)
}

function onExportSnapshot() {
  try {
    const file = session.exportSnapshot()
    const data = JSON.stringify(file, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cn-snapshot-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('快照已导出')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function onImportSnapshot(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    void session.runWrite(async () => {
      try {
        const raw = JSON.parse(String(reader.result))
        const r = session.importSnapshot(raw)
        if (r.ok) {
          toast.success('快照已导入')
          refresh()
        } else {
          toast.error(r.error ?? '导入失败')
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '导入失败')
      }
    })
  }
  reader.readAsText(file, 'utf-8')
  input.value = ''
}

onMounted(refresh)
onActivated(refresh)
</script>

<template>
  <div class="tables-page">
    <div v-if="!chatActive" class="cn-empty">未检测到聊天，请先在酒馆中打开一个对话</div>
    <template v-else>
      <div class="page-tabs">
        <button class="page-tab" :class="{ 'page-tab--active': pageTab === 'tables' }" @click="pageTab = 'tables'"><i class="fa-solid fa-table"></i> 表格</button>
        <button class="page-tab" :class="{ 'page-tab--active': pageTab === 'fill' }" @click="pageTab = 'fill'"><i class="fa-solid fa-pen-to-square"></i> 手动填表</button>
      </div>
      <ManualFill v-if="pageTab === 'fill'" />
      <template v-else>
        <div class="tables-toolbar">
        <button class="cn-btn cn-btn--sm" @click="onExportSnapshot">
          <i class="fa-solid fa-download"></i>
          导出快照
        </button>
        <label class="cn-btn cn-btn--sm">
          <i class="fa-solid fa-upload"></i>
          导入快照
          <input type="file" accept="application/json,.json" hidden @change="onImportSnapshot" />
        </label>
      </div>
      <div class="cn-card table-wrap-card">
        <div class="table-tabs">
          <button
            v-for="t in tables"
            :key="t.name"
            class="table-tab"
            :class="{ 'table-tab--active': t.name === activeName }"
            @click="switchTab(t.name)"
          >
            <span class="table-tab__zh">{{ t.displayName }}</span>
            <span class="table-tab__en">{{ t.name }}</span>
          </button>
        </div>
        <div class="table-body">
          <div v-if="(activeTable?.rows.length ?? 0) === 0" class="cn-empty">暂无数据</div>

          <div v-else class="table-row-grid">
            <TransitionGroup name="cn-list">
              <div
                v-for="row in activeTable?.rows ?? []"
                :key="row.__rowid__"
                class="cn-card table-row-card"
                :class="{ 'table-row-card--editing': row.__rowid__ === editingRowid }"
              >
                <div class="table-row-card__body">
                  <div
                    v-for="c in activeTable?.columns ?? []"
                    :key="c"
                    class="table-row-card__field"
                  >
                    <label class="table-row-card__label"
                      >{{ activeTable?.colNames[c] ?? c }}
                      <span class="table-row-card__label-en">{{ c }}</span></label
                    >
                    <div
                      v-if="row.__rowid__ === editingRowid"
                      class="cell-edit table-row-card__value"
                      contenteditable="true"
                      :ref="(el) => registerCellEl(c, el)"
                    ></div>
                    <div v-else class="cell-edit table-row-card__value">
                      {{ fieldValue(row, c) }}
                    </div>
                  </div>
                </div>
                <div class="table-row-card__foot">
                  <template v-if="row.__rowid__ === editingRowid">
                    <button class="cn-btn cn-btn--sm cn-btn--primary" @click="saveEdit">
                      保存
                    </button>
                    <button class="cn-btn cn-btn--sm" @click="cancelEdit">取消</button>
                  </template>
                  <template v-else>
                    <button class="cn-btn cn-btn--sm" @click="startEdit(row)">
                      <i class="fa-solid fa-pen"></i>
                      修改
                    </button>
                    <button
                      class="cn-btn cn-btn--sm cn-btn--text"
                      title="删除"
                      @click="deleteRow(row)"
                    >
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </template>
                </div>
              </div>
            </TransitionGroup>
          </div>
          <div class="table-body__foot">
            <span class="table-body__meta">
              {{ activeTable?.columns.length ?? 0 }} 列 · {{ activeTable?.rows.length ?? 0 }} 条
            </span>
            <button class="cn-btn cn-btn--sm" @click="addRow">
              <i class="fa-solid fa-plus"></i>
              添加条目
            </button>
          </div>
        </div>
      </div>
      </template>
    </template>
  </div>
</template>
