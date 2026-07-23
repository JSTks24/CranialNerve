<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated } from 'vue'
import { getSession } from '@core/session'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import { syncToWorldbook } from '@core/worldbook-sync'
import toast from '@ui/toast'
import confirm from '@ui/dialog'

interface ChronicleRow {
  __rowid__: number
  key: string
  time_start: string
  time_end: string
  location: string
  chronicle_text: string
  key_dialogue: string
}

const session = getSession()
const rows = ref<ChronicleRow[]>([])
const keyword = ref('')
const editingRowid = ref<number | null>(null)
const editSnapshot = ref<ChronicleRow | null>(null)

const fields: { key: keyof ChronicleRow; label: string; full?: boolean }[] = [
  { key: 'key', label: '编码' },
  { key: 'time_start', label: '起始时间' },
  { key: 'time_end', label: '结束时间' },
  { key: 'location', label: '地点' },
  { key: 'chronicle_text', label: '纪要正文', full: true },
  { key: 'key_dialogue', label: '重要台词', full: true }
]

function refresh() {
  const result = session.getTableRowsWithRowid(CHRONICLE_TABLE_NAME)
  const first = result[0]
  rows.value = (first?.rows ?? []) as unknown as ChronicleRow[]
}

let draftCounter = -1

const hasSession = computed(() => session.listTables().filter((n) => !n.startsWith('sqlite_')).length > 0)
const chronicleEnabled = computed(() => session.getConfig().chronicleGenEnabled)

function startEdit(row: ChronicleRow) {
  editingRowid.value = row.__rowid__
  editSnapshot.value = { ...row }
}

function cancelEdit() {
  const row = rows.value.find((r) => r.__rowid__ === editingRowid.value)
  if (row) {
    if (row.__rowid__ < 0) {
      rows.value = rows.value.filter((r) => r.__rowid__ !== row.__rowid__)
    } else if (editSnapshot.value) {
      Object.assign(row, editSnapshot.value)
    }
  }
  editingRowid.value = null
  editSnapshot.value = null
}

function saveEdit() {
  if (editingRowid.value == null) return
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  const row = rows.value.find((r) => r.__rowid__ === editingRowid.value)
  if (!row) {
    editingRowid.value = null
    return
  }
  try {
    if (row.__rowid__ < 0) {
      const values: Record<string, string> = {}
      for (const f of fields) {
        values[f.key] = String(row[f.key] ?? '')
      }
      session.insertRow(CHRONICLE_TABLE_NAME, values)
    } else {
      for (const f of fields) {
        const newVal = String(row[f.key] ?? '')
        const oldVal = editSnapshot.value ? String(editSnapshot.value[f.key] ?? '') : ''
        if (newVal !== oldVal) {
          session.updateCell(CHRONICLE_TABLE_NAME, editingRowid.value, f.key as string, newVal)
        }
      }
    }
    toast.success('已保存')
    persistChanges()
    refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
    if (row.__rowid__ >= 0 && editSnapshot.value) {
      Object.assign(row, editSnapshot.value)
    }
  }
  editingRowid.value = null
  editSnapshot.value = null
}

function persistChanges() {
  const chat = session.chat.getChat()
  const lastMsgId = chat.length - 1
  if (lastMsgId >= 0) {
    session.saveToChat(lastMsgId)
  }
  syncToWorldbook(session).catch(() => {})
}

function addRow() {
  const draft: ChronicleRow = {
    __rowid__: draftCounter--,
    key: '',
    time_start: '',
    time_end: '',
    location: '',
    chronicle_text: '',
    key_dialogue: ''
  }
  rows.value.push(draft)
  startEdit(draft)
}

async function deleteRow(row: ChronicleRow) {
  const ok = await confirm('删除确认', `确认删除纪要「${row.key}」？`, '删除', true)
  if (!ok) return
  try {
    session.deleteRow(CHRONICLE_TABLE_NAME, row.__rowid__)
    rows.value = rows.value.filter((r) => r.__rowid__ !== row.__rowid__)
    toast.success(`已删除 ${row.key}`)
    persistChanges()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
  }
}

const filtered = ref<ChronicleRow[]>([])
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

    <div v-if="!chronicleEnabled" class="cn-empty">纪要生成功能未开启，请到首页开启</div>
	    <div v-else-if="!hasSession" class="cn-empty">当前会话未载入表格</div>
    <div v-else-if="filtered.length === 0" class="cn-empty">
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
          <span class="chronicle-item__key">{{ row.key }}</span>
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
                class="cell-edit chronicle-field__value"
                :contenteditable="row.__rowid__ === editingRowid"
                @blur="
                  (e) => {
                    if (row.__rowid__ === editingRowid)
                      row[f.key] = (e.target as HTMLElement).innerText as never
                  }
                "
              >
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
              class="cell-edit chronicle-field__value"
              :contenteditable="row.__rowid__ === editingRowid"
              @blur="
                (e) => {
                  if (row.__rowid__ === editingRowid)
                    row[f.key] = (e.target as HTMLElement).innerText as never
                }
              "
            >
              {{ row[f.key] ?? '' }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
