<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue'
import { getSession } from '@core/session'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import toast from '@ui/toast'
import confirm from '@ui/dialog'

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
const activeName = ref<string>('')
const editingRowid = ref<number | null>(null)
const editSnapshot = ref<Record<string, string>>({})
let draftCounter = -1

const activeTable = computed(() => tables.value.find((t) => t.name === activeName.value))

function switchTab(name: string) {
  if (editingRowid.value != null) {
    cancelEdit()
  }
  activeName.value = name
}

function refresh() {
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
}

function cancelEdit() {
  if (!activeTable.value || editingRowid.value == null) return
  const row = activeTable.value.rows.find((r) => r.__rowid__ === editingRowid.value)
  if (row) {
    if (row.__rowid__ < 0) {
      activeTable.value.rows = activeTable.value.rows.filter((r) => r.__rowid__ !== row.__rowid__)
    } else {
      for (const c of activeTable.value.columns) {
        row[c] = editSnapshot.value[c] ?? ''
      }
    }
  }
  editingRowid.value = null
  editSnapshot.value = {}
}

function saveEdit() {
  if (!activeTable.value || editingRowid.value == null) return
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  const row = activeTable.value.rows.find((r) => r.__rowid__ === editingRowid.value)
  if (!row) {
    editingRowid.value = null
    return
  }
  try {
    if (row.__rowid__ < 0) {
      const values: Record<string, string> = {}
      for (const c of activeTable.value.columns) {
        values[c] = String(row[c] ?? '')
      }
      session.insertRow(activeTable.value.name, values)
    } else {
      for (const c of activeTable.value.columns) {
        const newVal = String(row[c] ?? '')
        if (newVal !== editSnapshot.value[c]) {
          session.updateCell(activeTable.value.name, editingRowid.value, c, newVal)
        }
      }
    }
    toast.success('已保存')
    refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
    if (row.__rowid__ >= 0) {
      for (const c of activeTable.value.columns) {
        row[c] = editSnapshot.value[c] ?? ''
      }
    }
  }
  editingRowid.value = null
  editSnapshot.value = {}
}

async function deleteRow(row: RowData) {
  if (!activeTable.value) return
  const ok = await confirm('删除确认', '确认删除该行？此操作不可撤销。', '删除', true)
  if (!ok) return
  try {
    session.deleteRow(activeTable.value.name, row.__rowid__)
    if (activeTable.value) {
      activeTable.value.rows = activeTable.value.rows.filter((r) => r.__rowid__ !== row.__rowid__)
    }
    toast.success('已删除')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
  }
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

onMounted(refresh)
onActivated(refresh)
</script>

<template>
  <div class="tables-page">
    <div v-if="tables.length === 0" class="cn-empty">当前会话未载入表格</div>

    <template v-else>
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
          <div v-if="(activeTable?.rows.length ?? 0) === 0" class="cn-empty">
            暂无数据
          </div>

          <div v-else class="table-row-grid">
            <div
              v-for="row in activeTable?.rows ?? []"
              :key="row.__rowid__"
              class="cn-card table-row-card"
              :class="{ 'table-row-card--editing': row.__rowid__ === editingRowid }"
            >
              <div class="table-row-card__body">
                <div v-for="c in activeTable?.columns ?? []" :key="c" class="table-row-card__field">
                  <label class="table-row-card__label"
                    >{{ activeTable?.colNames[c] ?? c }}
                    <span class="table-row-card__label-en">{{ c }}</span></label
                  >
                  <div
                    class="cell-edit table-row-card__value"
                    :contenteditable="row.__rowid__ === editingRowid"
                    @blur="
                      (e) => {
                        if (row.__rowid__ === editingRowid)
                          row[c] = (e.target as HTMLElement).innerText
                      }
                    "
                  >
                    {{ fieldValue(row, c) }}
                  </div>
                </div>
              </div>
              <div class="table-row-card__foot">
                <template v-if="row.__rowid__ === editingRowid">
                  <button class="cn-btn cn-btn--sm cn-btn--primary" @click="saveEdit">保存</button>
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
  </div>
</template>
