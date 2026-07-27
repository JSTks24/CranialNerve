<script setup lang="ts">
import { ref, computed, onActivated } from 'vue'
import draggable from 'vuedraggable'
import { useConfigStore } from '@ui/stores/config'
import { getSession } from '@core/session'
import type {
  PromptBlock,
  PromptRole,
  PromptSceneKey,
  PromptSegment,
  ScenePreset
} from '@shared/types/config'
import type { TableDef, ColumnDef } from '@shared/types/table'
import type { CardTemplate } from '@shared/types/card'
import { isShujukuTemplate, convertShujukuToCardTemplate, isCardTemplate } from '@shared/template-convert'
import { SQL_EDIT_FORMAT } from '@shared/constants/sql-json'
import { interpolate } from '@shared/prompts/interpolate'
import toast from '@ui/toast'
import confirm from '@ui/dialog'

const session = getSession()
const store = useConfigStore()
const config = computed(() => store.config.prompt)

const scenes: { key: PromptSceneKey; label: string; desc: string }[] = [
  { key: 'tableEdit', label: '表格更新', desc: 'AI 填表时发送。变量：{{format}} {{timeFormat}} {{tables}}' },
  {
    key: 'chronicleRecall',
    label: '纪要召回',
    desc: '筛选相关纪要。变量：{{chronicleList}} {{userInput}} {{keyExample}}'
  },
  { key: 'chronicleGenerate', label: '纪要生成', desc: '提取纪要内容。变量：{{timeFormat}}' }
]

const activeScene = ref<PromptSceneKey>('tableEdit')
const roles: PromptRole[] = ['system', 'user', 'assistant']
const roleLabels: Record<PromptRole, string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant'
}
const varExample = '{{变量名}}'

const sceneConfig = computed(() => config.value[activeScene.value])
const activePreset = computed(
  () =>
    sceneConfig.value.presets.find((p) => p.id === sceneConfig.value.activeId) ??
    sceneConfig.value.presets[0]
)

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function selectPreset(id: string) {
  sceneConfig.value.activeId = id
  save()
}

function newPreset() {
  const p: ScenePreset = {
    id: newId('preset'),
    name: `预设 ${sceneConfig.value.presets.length + 1}`,
    blocks: [
      {
        id: newId('blk'),
        name: '主指令',
        segments: [{ id: newId('seg'), role: 'system', content: '' }]
      }
    ]
  }
  sceneConfig.value.presets.push(p)
  sceneConfig.value.activeId = p.id
  save()
  toast.success('已新建预设')
}

async function deletePreset(id: string) {
  if (sceneConfig.value.presets.length <= 1) {
    toast.warning('至少保留一个预设')
    return
  }
  const target = sceneConfig.value.presets.find((p) => p.id === id)
  if (!target) return
  const ok = await confirm(
    '删除确认',
    `确认删除预设「${target.name}」？此操作不可撤销。`,
    '删除',
    true
  )
  if (!ok) return
  sceneConfig.value.presets = sceneConfig.value.presets.filter((p) => p.id !== id)
  if (sceneConfig.value.activeId === id) {
    sceneConfig.value.activeId = sceneConfig.value.presets[0]!.id
  }
  if (sceneConfig.value.defaultId === id) {
    sceneConfig.value.defaultId = sceneConfig.value.presets[0]!.id
  }
  save()
  toast.success('已删除')
}

function setDefaultPreset(id: string) {
  sceneConfig.value.defaultId = id
  save()
  toast.success('已设为默认')
}

function addBlock() {
  if (!activePreset.value) return
  activePreset.value.blocks.push({
    id: newId('blk'),
    name: `块 ${activePreset.value.blocks.length + 1}`,
    segments: [{ id: newId('seg'), role: 'system', content: '' }]
  })
}

function removeBlock(id: string) {
  if (!activePreset.value) return
  if (activePreset.value.blocks.length <= 1) {
    toast.warning('至少保留一个块')
    return
  }
  activePreset.value.blocks = activePreset.value.blocks.filter((b) => b.id !== id)
}

function addSegment(block: PromptBlock, role: PromptRole) {
  block.segments.push({ id: newId('seg'), role, content: '' })
}

function removeSegment(block: PromptBlock, id: string) {
  block.segments = block.segments.filter((s) => s.id !== id)
}

function cycleRole(seg: PromptSegment) {
  const idx = roles.indexOf(seg.role)
  seg.role = roles[(idx + 1) % roles.length]!
}

function globalIndex(blockIdx: number, segIdx: number): number {
  if (!activePreset.value) return 0
  let n = 0
  for (let i = 0; i < blockIdx; i++) {
    n += activePreset.value.blocks[i]?.segments.length ?? 0
  }
  return n + segIdx + 1
}

function save() {
  store.save()
}

function saveAll() {
  save()
  toast.success('已保存')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildVarValues(): Record<string, string> {
  const values: Record<string, string> = {
    format: SQL_EDIT_FORMAT,
    timeFormat: 'ISO 8601 格式（YYYY-MM-DDTHH:MM）',
    keyExample: 'CN0001',
    userInput: '（玩家输入：无）',
    tables: '（当前无表数据）',
    chronicleList: '（当前无纪要）'
  }
  if (activeScene.value === 'tableEdit') {
    const tables = session.listTables()
    if (tables.length > 0) {
      values.tables = tables
        .map((t) => {
          const result = session.getTableData(t)
          const rows = result[0]?.rows ?? []
          return `-- 表: ${t}\n-- 当前数据 (${rows.length} 行):\n${JSON.stringify(rows)}`
        })
        .join('\n\n')
    }
  }
  return values
}

function renderContent(content: string): string {
  const escaped = escapeHtml(content)
  return escaped.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    return `<span class="seg-var">{{${name}}}</span>`
  })
}

function onContentBlur(seg: PromptSegment, e: Event) {
  const el = e.target as HTMLElement
  seg.content = el.innerText
  editingSegId.value = null
}

const editingSegId = ref<string | null>(null)

function syncSegHtml(el: unknown, id: string, content: string) {
	if (!(el instanceof HTMLElement)) return
	if (editingSegId.value === id) return
	el.innerHTML = renderContent(content)
}

const previewVisible = ref(false)
const previewJson = ref('')

async function openPreview() {
  save()
  const values = buildVarValues()
  const realValues: Record<string, string> = { ...values }
  if (activeScene.value === 'chronicleRecall') {
    try {
      const result = session.getTableRowsWithRowid('cn_chronicle')
      const rows = result[0]?.rows ?? []
      if (rows.length > 0) {
        realValues.chronicleList = JSON.stringify(
          rows.map((r) => ({ key: String(r.key ?? ''), summary: String(r.chronicle_text ?? '') })),
          null,
          2
        )
      }
    } catch {
    }
  }
  const segs = activePreset.value?.blocks.flatMap((b) => b.segments) ?? []
  const messages = segs.map((s) => ({
    role: s.role,
    content: interpolate(s.content, realValues)
  }))
  previewJson.value = JSON.stringify(messages, null, 2)
  previewVisible.value = true
}

function closePreview() {
  previewVisible.value = false
}

function exportPreset() {
  if (!activePreset.value) return
  const data = JSON.stringify(activePreset.value, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${activePreset.value.name}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast.success('已导出')
}

function importPreset(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as ScenePreset
      if (!Array.isArray(parsed.blocks)) {
        throw new Error('格式不符')
      }
      parsed.id = newId('preset')
      sceneConfig.value.presets.push(parsed)
      sceneConfig.value.activeId = parsed.id
      save()
      toast.success('已导入')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败')
    }
  }
  reader.readAsText(file, 'utf-8')
  input.value = ''
}

const showTemplate = ref(false)
const COL_TYPES = ['TEXT', 'INTEGER', 'REAL', 'BLOB']

function freshTable(): TableDef {
	return { name: '', displayName: '', columns: [], note: '', insertHint: '', updateHint: '', deleteHint: '', exportConfig: { enabled: true, entryType: 'constant', splitByRow: false, keywordColumn: '', keywords: '' } }
}

function ensureExportConfig(table: TableDef) {
	if (!table.exportConfig) {
		table.exportConfig = { enabled: true, entryType: 'constant', splitByRow: false, keywordColumn: '', keywords: '' }
	}
}

function freshColumn(): ColumnDef {
	return { name: '', displayName: '', type: 'TEXT' }
}

const ttConfig = computed(() => store.config.tableTemplate)

const activeTemplatePreset = computed(() =>
	ttConfig.value.presets.find((p) => p.id === ttConfig.value.activeId) ?? ttConfig.value.presets[0]
)

const editingTables = computed(() => activeTemplatePreset.value?.template?.tables ?? [])

const selectedTableIdx = ref(-1)

const selectedTable = computed(() => {
  const tables = editingTables.value
  if (selectedTableIdx.value < 0 || selectedTableIdx.value >= tables.length) return null
  return tables[selectedTableIdx.value]
})


function newPresetT() {
  const p = {
    id: newId('tpl'),
    name: `模板 ${ttConfig.value.presets.length + 1}`,
    template: { templateVersion: 1, tables: [] },
    source: 'user' as const
  }
  ttConfig.value.presets.push(p)
  ttConfig.value.activeId = p.id
  selectedTableIdx.value = -1
  store.save()
  toast.success('已新建模板预设')
}

function syncCardTemplate() {
  const fromCard = session.getTemplate()
  if (!fromCard || !Array.isArray(fromCard.tables) || fromCard.tables.length === 0) return

  const CARD_PRESET_ID = '__card__'
  const existing = ttConfig.value.presets.find((p) => p.id === CARD_PRESET_ID)
  const cardPreset = {
    id: CARD_PRESET_ID,
    name: '当前角色卡',
    template: JSON.parse(JSON.stringify(fromCard)),
    source: 'card' as const
  }

  if (existing) {
    existing.template = cardPreset.template
    existing.source = 'card'
  } else {
    ttConfig.value.presets.unshift(cardPreset)
  }

  if (ttConfig.value.activeId !== CARD_PRESET_ID && !existing) {
    ttConfig.value.activeId = CARD_PRESET_ID
  }
  if (!ttConfig.value.defaultId) {
    ttConfig.value.defaultId = CARD_PRESET_ID
  }
  store.save()
}

async function selectPresetT(id: string) {
  const target = ttConfig.value.presets.find((p) => p.id === id)
  if (!target || id === ttConfig.value.activeId) return

  const current = ttConfig.value.presets.find((p) => p.id === ttConfig.value.activeId)
  if (current?.source === 'card') {
    const ok = await confirm(
      '切换模板',
      '当前使用的是角色卡自带模板，不建议切换。切换后表格结构可能与角色卡不匹配。\n\n确定要切换吗？',
      '仍然切换',
      true
    )
    if (!ok) return
  }

  const tables = session.listTables().filter((n) => n !== 'cn_chronicle' && !n.startsWith('sqlite_'))
  if (tables.length > 0) {
    const ok = await confirm(
      '⚠️ 数据丢失风险',
      `当前已有 ${tables.length} 张数据表。切换模板将删除所有表及其数据，且不可撤销。\n\n确定要切换吗？`,
      '删除数据并切换',
      true
    )
    if (!ok) return
  }

  ttConfig.value.activeId = id
  selectedTableIdx.value = -1
  store.save()
}

async function deletePresetT(id: string) {
  if (ttConfig.value.presets.length <= 1) {
    toast.warning('至少保留一个预设')
    return
  }
  const target = ttConfig.value.presets.find((p) => p.id === id)
  if (!target) return
  if (target.source === 'card') {
    toast.warning('角色卡自带模板不可删除')
    return
  }
  const ok = await confirm('删除确认', `确认删除模板预设「${target.name}」？此操作不可撤销。`, '删除', true)
  if (!ok) return
  ttConfig.value.presets = ttConfig.value.presets.filter((p) => p.id !== id)
  if (ttConfig.value.activeId === id) ttConfig.value.activeId = ttConfig.value.presets[0]!.id
  if (ttConfig.value.defaultId === id) ttConfig.value.defaultId = ttConfig.value.presets[0]!.id
  selectedTableIdx.value = -1
  store.save()
  toast.success('已删除')
}

function setDefaultPresetT(id: string) {
  ttConfig.value.defaultId = id
  store.save()
  toast.success('已设为默认')
}

function addTableT() {
  if (!activeTemplatePreset.value) return
  activeTemplatePreset.value.template.tables.push(freshTable())
  selectedTableIdx.value = activeTemplatePreset.value.template.tables.length - 1
}

async function removeTableT(idx: number) {
  const t = editingTables.value[idx]
  if (!t) return
  const ok = await confirm('删除确认', `确认删除表「${t.displayName || t.name || '(未命名)'}」？`, '删除', true)
  if (!ok) return
  activeTemplatePreset.value!.template.tables.splice(idx, 1)
  if (selectedTableIdx.value >= editingTables.value.length) {
    selectedTableIdx.value = editingTables.value.length - 1
  }
}

function addColumnT() {
  if (!selectedTable.value) return
  selectedTable.value.columns.push(freshColumn())
}

function removeColumnT(idx: number) {
  if (!selectedTable.value) return
  selectedTable.value.columns.splice(idx, 1)
}

function toggleConstraint(col: ColumnDef, key: 'primaryKey' | 'unique' | 'nullable') {
  if (!col.constraints) col.constraints = {}
  col.constraints[key] = !col.constraints[key]
}

function saveTemplate() {
  store.save()
  toast.success('已保存')
}

function importTemplate(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const raw = JSON.parse(String(reader.result))
      let template: CardTemplate

      if (isCardTemplate(raw)) {
        template = raw
      } else if (isShujukuTemplate(raw)) {
        template = convertShujukuToCardTemplate(raw)
        toast.success('检测到 shujuku 格式，已自动转换')
      } else {
        throw new Error('无法识别模板格式（需要 CardTemplate 或 shujuku TABLE_TEMPLATE）')
      }

      const preset = {
        id: newId('tpl'),
        name: file.name.replace(/\.json$/i, ''),
        template,
        source: 'user' as const
      }
      ttConfig.value.presets.push(preset)
      ttConfig.value.activeId = preset.id
      selectedTableIdx.value = -1
      store.save()
      toast.success('已导入')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败')
    }
  }
  reader.readAsText(file, 'utf-8')
  input.value = ''
}

function exportTemplate() {
  if (!activeTemplatePreset.value) return
  const data = JSON.stringify(activeTemplatePreset.value.template, null, 2)
  downloadJson(data, `${activeTemplatePreset.value.name}.json`)
}

function downloadJson(data: string, filename: string) {
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  toast.success('已导出')
}

onActivated(() => {
  store.reload()
  syncCardTemplate()
})
</script>

<template>
  <div class="prompt-page">
    <div class="prompt-wrap cn-card">
      <!-- ═══ 顶层 Tab：表格模板 / 提示词配置 ═══ -->
      <div class="prompt-head">
        <div class="scene-tabs">
          <button type="button" class="scene-tab" :class="{ 'scene-tab--active': showTemplate }" @click="showTemplate = true">
            <i class="fa-solid fa-table"></i>
            表格模板
          </button>
          <button type="button" class="scene-tab" :class="{ 'scene-tab--active': !showTemplate }" @click="showTemplate = false">
            <i class="fa-solid fa-pen-to-square"></i>
            提示词配置
          </button>
        </div>
        <div v-if="!showTemplate" class="scene-tabs">
          <button
            v-for="s in scenes"
            :key="s.key"
            type="button"
            class="scene-tab"
            :class="{ 'scene-tab--active': activeScene === s.key }"
            @click="activeScene = s.key"
          >
            {{ s.label }}
          </button>
        </div>
      </div>

      <!-- ═══ 表格模板编辑器 ═══ -->
      <div v-if="showTemplate" class="prompt-split">
        <!-- 左侧：模板预设列表 -->
        <div class="prompt-side">
          <div class="cn-card__head">
            <span>模板预设</span>
            <button class="cn-btn cn-btn--sm" @click="newPresetT">
              <i class="fa-solid fa-plus"></i>
              新建
            </button>
          </div>
          <div class="cn-card__body">
            <ul class="preset-list">
              <li v-for="p in ttConfig.presets" :key="p.id"
                class="preset-list__item"
                :class="{ 'preset-list__item--active': p.id === ttConfig.activeId }"
                @click="selectPresetT(p.id)">
                <span class="preset-list__name">
                  <i v-if="p.source === 'card'" class="fa-solid fa-id-card preset-list__card" title="角色卡自带模板"></i>
                  {{ p.name }}
                  <i v-if="p.id === ttConfig.defaultId" class="fa-solid fa-star preset-list__default" title="默认预设"></i>
                </span>
                <span class="preset-list__count">{{ p.template.tables.length }}表</span>
                <button v-if="p.id !== ttConfig.activeId" class="cn-btn cn-btn--sm cn-btn--text" title="设为当前" @click.stop="selectPresetT(p.id)">
                  <i class="fa-solid fa-check"></i>
                </button>
                <button v-if="p.id !== ttConfig.defaultId" class="cn-btn cn-btn--sm cn-btn--text" title="设为默认" @click.stop="setDefaultPresetT(p.id)">
                  <i class="fa-solid fa-star"></i>
                </button>
                <button v-if="p.source !== 'card'" class="cn-btn cn-btn--sm cn-btn--text" title="删除" @click.stop="deletePresetT(p.id)">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </li>
            </ul>
          </div>
        </div>

        <!-- 右侧：选中模板的全部表 -->
        <div class="prompt-editor" v-if="activeTemplatePreset">
          <div class="cn-card__head">
            <input class="cn-input" style="width:200px;font-weight:600" v-model="activeTemplatePreset.name" placeholder="模板名称" />
            <button class="cn-btn cn-btn--sm" @click="addTableT"><i class="fa-solid fa-plus"></i>添加表</button>
          </div>
          <div class="cn-card__body template-editor-body">
            <div v-if="editingTables.length === 0" class="template-editor-empty">
              <span>此模板尚无数据表，点击"添加表"开始</span>
            </div>
            <div v-for="(table, ti) in editingTables" :key="ti"
              class="tpl-table-card"
              :class="{ 'tpl-table-card--active': ti === selectedTableIdx }"
              @click="selectedTableIdx = ti">
              <div class="tpl-table-card__head">
                <span class="tpl-table-card__name">{{ table.displayName || table.name || '(未命名)' }}</span>
                <span class="tpl-table-card__meta">{{ table.columns.length }}列</span>
                <button class="cn-btn cn-btn--sm cn-btn--text" title="删除表" @click.stop="removeTableT(ti)">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
              <div v-if="ti === selectedTableIdx" class="tpl-table-card__body">
                <div class="tpl-row">
                  <div class="tpl-field">
                    <label class="tpl-label">英文表名</label>
                    <input class="cn-input" v-model="table.name" placeholder="snake_case" />
                  </div>
                  <div class="tpl-field">
                    <label class="tpl-label">中文表名</label>
                    <input class="cn-input" v-model="table.displayName" placeholder="给 AI 看的表名" />
                  </div>
                </div>
                <div class="tpl-section">
                  <label class="tpl-label">表说明 (note)</label>
                  <textarea class="cn-textarea tpl-textarea" v-model="table.note" rows="2" placeholder="描述表的用途、每列填什么..."></textarea>
                </div>
                <div class="tpl-section">
                  <label class="tpl-label">世界书注入</label>
                  <div class="tpl-row" style="align-items:center">
                    <div class="tpl-field" style="flex-direction:row;align-items:center;gap:8px">
                      <label class="tpl-label" style="font-size:12px">启用注入</label>
                      <label class="cn-switch">
                        <input type="checkbox"
                          :checked="table.exportConfig?.enabled !== false"
                          @change="ensureExportConfig(table); table.exportConfig!.enabled = ($event.target as HTMLInputElement).checked" />
                        <span class="cn-switch__track"></span>
                      </label>
                    </div>
                    <div class="tpl-field">
                      <label class="tpl-label" style="font-size:12px">注入类型</label>
                      <select class="cn-select" style="width:auto"
                        @change="ensureExportConfig(table); table.exportConfig!.entryType = ($event.target as HTMLSelectElement).value as 'constant' | 'keyword'">
                        <option value="constant" :selected="(table.exportConfig?.entryType ?? 'constant') === 'constant'">常量（始终注入）</option>
                        <option value="keyword" :selected="table.exportConfig?.entryType === 'keyword'">关键词（召回触发）</option>
                      </select>
                    </div>
                  </div>
                  <div v-if="table.exportConfig?.entryType === 'keyword'" class="tpl-row" style="margin-top:8px">
                    <div class="tpl-field">
                      <label class="tpl-label" style="font-size:12px">触发关键词</label>
                      <input class="cn-input"
                        :value="table.exportConfig?.keywords ?? ''"
                        @input="ensureExportConfig(table); table.exportConfig!.keywords = ($event.target as HTMLInputElement).value"
                        placeholder="逗号分隔，如：背包, 物品, 装备" />
                    </div>
                  </div>
                </div>
                <div class="tpl-section">
                  <div class="tpl-section__head">
                    <label class="tpl-label">列定义</label>
                    <button class="cn-btn cn-btn--sm" @click="addColumnT"><i class="fa-solid fa-plus"></i>添加列</button>
                  </div>
                  <div class="tpl-cols">
                    <div class="tpl-col-head">
                      <span class="tpl-col-cell name">英文名</span>
                      <span class="tpl-col-cell name">中文名</span>
                      <span class="tpl-col-cell type">类型</span>
                      <span class="tpl-col-cell flags">约束</span>
                      <span class="tpl-col-cell note">AI 提示</span>
                      <span class="tpl-col-cell del"></span>
                    </div>
                    <div v-for="(col, ci) in table.columns" :key="ci" class="tpl-col-row">
                      <input class="cn-input tpl-col-cell name" v-model="col.name" placeholder="col_name" />
                      <input class="cn-input tpl-col-cell name" v-model="col.displayName" placeholder="中文名" />
                      <select class="cn-select tpl-col-cell type" v-model="col.type">
                        <option v-for="t in COL_TYPES" :key="t" :value="t">{{ t }}</option>
                      </select>
                      <span class="tpl-col-cell flags">
                        <button class="cn-btn cn-btn--xs" :class="{ 'cn-btn--primary': col.constraints?.primaryKey }" title="主键" @click="toggleConstraint(col, 'primaryKey')">PK</button>
                        <button class="cn-btn cn-btn--xs" :class="{ 'cn-btn--primary': col.constraints?.unique }" title="唯一" @click="toggleConstraint(col, 'unique')">UQ</button>
                        <button class="cn-btn cn-btn--xs" :class="{ 'cn-btn--primary': !col.constraints?.nullable }" title="非空" @click="toggleConstraint(col, 'nullable')">NN</button>
                      </span>
                      <input class="cn-input tpl-col-cell note" v-model="col.note" placeholder="给 AI 的列说明" />
                      <button class="cn-btn cn-btn--sm cn-btn--text tpl-col-cell del" title="删除列" @click="removeColumnT(ci)">
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                </div>
                <div class="tpl-section">
                  <label class="tpl-label">新增行提示 (insertHint)</label>
                  <textarea class="cn-textarea tpl-textarea" v-model="table.insertHint" rows="2" placeholder="例如：角色获得新物品时插入一行..."></textarea>
                </div>
                <div class="tpl-section">
                  <label class="tpl-label">更新行提示 (updateHint)</label>
                  <textarea class="cn-textarea tpl-textarea" v-model="table.updateHint" rows="2" placeholder="例如：物品数量变化时更新..."></textarea>
                </div>
                <div class="tpl-section">
                  <label class="tpl-label">删除行提示 (deleteHint)</label>
                  <textarea class="cn-textarea tpl-textarea" v-model="table.deleteHint" rows="2" placeholder="例如：角色消耗掉物品时删除..."></textarea>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="prompt-editor" v-else>
          <div class="cn-card__body template-editor-empty">
            <span>从左侧选择一个模板预设开始编辑</span>
          </div>
        </div>
      </div>

      <!-- ═══ 提示词编辑器（现有内容，原封不动） ═══ -->
      <template v-if="!showTemplate">
      <div class="prompt-split">
        <div class="prompt-side">
          <div class="cn-card__head">
            <span>预设</span>
            <button class="cn-btn cn-btn--sm" @click="newPreset">
              <i class="fa-solid fa-plus"></i>
              新建
            </button>
          </div>
          <div class="cn-card__body">
            <ul class="preset-list">
              <li
                v-for="p in sceneConfig.presets"
                :key="p.id"
                class="preset-list__item"
                :class="{ 'preset-list__item--active': p.id === sceneConfig.activeId }"
                @click="selectPreset(p.id)"
              >
                <span class="preset-list__name">
                  {{ p.name }}
                  <i
                    v-if="p.id === sceneConfig.defaultId"
                    class="fa-solid fa-star preset-list__default"
                    title="默认预设"
                  ></i>
                </span>
                <span class="preset-list__count">{{ p.blocks.length }}块</span>
                <button
                  v-if="p.id !== sceneConfig.activeId"
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="设为当前"
                  @click.stop="selectPreset(p.id)"
                >
                  <i class="fa-solid fa-check"></i>
                </button>
                <button
                  v-if="p.id !== sceneConfig.defaultId"
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="设为默认"
                  @click.stop="setDefaultPreset(p.id)"
                >
                  <i class="fa-solid fa-star"></i>
                </button>
                <button
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="删除"
                  @click.stop="deletePreset(p.id)"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div class="prompt-editor">
          <div class="cn-card__head">
            <span>{{ activePreset?.name }}</span>
            <span class="prompt-editor__desc">{{
              scenes.find((s) => s.key === activeScene)?.desc
            }}</span>
          </div>
          <div class="cn-card__body">
            <draggable
              :list="activePreset?.blocks ?? []"
              item-key="id"
              :animation="150"
              handle=".block-head__grip"
              ghost-class="block--ghost"
              class="block-list"
            >
              <template #item="{ element: block, index: bi }">
                <div class="block">
                  <div class="block-head">
                    <i class="fa-solid fa-grip-vertical block-head__grip"></i>
                    <input
                      class="cn-input block-head__name"
                      v-model="block.name"
                      placeholder="块名称"
                    />
                    <button
                      class="cn-btn cn-btn--sm cn-btn--text"
                      title="删除块"
                      @click="removeBlock(block.id)"
                    >
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                  <draggable
                    :list="block.segments"
                    :group="{ name: 'segs', pull: true, put: true }"
                    item-key="id"
                    :animation="150"
                    handle=".seg-item__grip"
                    ghost-class="seg-item--ghost"
                    class="block-segs"
                  >
                    <template #item="{ element: seg, index: si }">
                      <div class="seg-item">
                        <div class="seg-item__bar">
                          <i class="fa-solid fa-grip-vertical seg-item__grip"></i>
                          <button
                            class="seg-item__role"
                            :title="`点击切换角色（当前 ${roleLabels[seg.role]}）`"
                            @click="cycleRole(seg)"
                          >
                            {{ roleLabels[seg.role] }}
                          </button>
                          <span class="seg-item__seq">#{{ globalIndex(bi, si) }}</span>
                          <button
                            class="cn-btn cn-btn--sm cn-btn--text"
                            title="删除"
                            @click="removeSegment(block, seg.id)"
                          >
                            <i class="fa-solid fa-trash"></i>
                          </button>
                        </div>
                        <div
                          class="seg-item__edit"
                          contenteditable="true"
                          :ref="(el) => syncSegHtml(el, seg.id, seg.content)"
                          @focus="editingSegId = seg.id"
                          @blur="onContentBlur(seg, $event)"
                        ></div>
                      </div>
                    </template>
                  </draggable>
                  <div class="block-add">
                    <button
                      v-for="r in roles"
                      :key="r"
                      class="cn-btn cn-btn--sm cn-btn--text"
                      @click="addSegment(block, r)"
                    >
                      <i class="fa-solid fa-plus"></i>
                      {{ roleLabels[r] }}
                    </button>
                  </div>
                </div>
              </template>
            </draggable>
            <button class="cn-btn block-add-btn" @click="addBlock">
              <i class="fa-solid fa-plus"></i>
              添加对话块
            </button>
          </div>
        </div>
      </div>
      </template>
    </div>

    <div v-if="showTemplate" class="prompt-foot">
      <span class="prompt-foot__hint">
        每个模板预设含多张数据表及其 AI 行为提示词。导入支持 CN 和 shujuku 两种格式。
      </span>
      <div class="cn-space">
        <label class="cn-btn">
          <i class="fa-solid fa-upload"></i>
          导入
          <input type="file" accept="application/json,.json" hidden @change="importTemplate" />
        </label>
        <button class="cn-btn" @click="exportTemplate">
          <i class="fa-solid fa-download"></i>
          导出
        </button>
        <button class="cn-btn cn-btn--primary" @click="saveTemplate">保存</button>
      </div>
    </div>

    <template v-if="!showTemplate">
    <div class="prompt-foot">
      <span class="prompt-foot__hint">
        段内用 <code>{{ varExample }}</code> 插入变量。点击角色标签切换
        System/User/Assistant，拖拽手柄调整顺序。多个对话块层层堆叠模拟多轮对话。
      </span>
      <div class="cn-space">
        <label class="cn-btn">
          <i class="fa-solid fa-upload"></i>
          导入
          <input type="file" accept="application/json,.json" hidden @change="importPreset" />
        </label>
        <button class="cn-btn" @click="exportPreset">
          <i class="fa-solid fa-download"></i>
          导出
        </button>
        <button class="cn-btn" @click="openPreview">
          <i class="fa-solid fa-eye"></i>
          预览
        </button>
        <button class="cn-btn cn-btn--primary" @click="saveAll">保存</button>
      </div>
    </div>

    <div v-if="previewVisible" class="cn-modal-mask" @click.self="closePreview">
      <div class="cn-modal">
        <div class="cn-modal__head">
          <span>发给 AI 的 messages</span>
          <button class="cn-btn cn-btn--sm cn-btn--text" @click="closePreview">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <pre class="cn-modal__code">{{ previewJson }}</pre>
      </div>
    </div>
    </template>
  </div>
</template>
