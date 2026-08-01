<script setup lang="ts">
import { ref, computed, onActivated } from 'vue'
import draggable from 'vuedraggable'
import { useConfigStore } from '@ui/stores/config'
import { getSession } from '@core/session'
import type { PromptRole, PromptSceneKey, PromptSegment, ScenePreset } from '@shared/types/config'
import type { ChronicleColumnRole, TableDef, ColumnDef } from '@shared/types/table'
import type { CardTemplate } from '@shared/types/card'
import {
  isShujukuTemplate,
  convertShujukuToCardTemplate,
  isCardTemplate
} from '@shared/template-convert'
import { buildCreateTableSql } from '@shared/template-builder'
import { SQL_EDIT_FORMAT } from '@shared/constants/sql-json'
import { interpolate } from '@shared/prompts/interpolate'
import toast from '@ui/toast'
import confirm from '@ui/dialog'
import PromptSegmentEditor from '@ui/components/PromptSegmentEditor.vue'
import CNTabs from '@ui/components/CNTabs.vue'
import { DEFAULT_CHRONICLE_TABLE } from '@shared/constants/chronicle'

const session = getSession()
const store = useConfigStore()
const config = computed(() => store.config.prompt)

const scenes: { key: PromptSceneKey; label: string; desc: string }[] = [
  {
    key: 'tableEdit',
    label: '表格更新',
    desc: 'AI 填表时发送。变量：{{format}} {{timeFormat}} {{tables}}'
  },
  {
    key: 'chronicleRecall',
    label: '纪要召回',
    desc: '筛选相关纪要。变量：{{chronicleList}} {{userInput}} {{keyExample}}'
  }
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
    segments: [{ id: newId('seg'), name: '主指令', role: 'system', content: '' }]
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

function addSegment(role: PromptRole) {
  if (!activePreset.value) return
  activePreset.value.segments.push({
    id: newId('seg'),
    name: `段 ${activePreset.value.segments.length + 1}`,
    role,
    content: ''
  })
}

function removeSegment(id: string) {
  if (!activePreset.value) return
  if (activePreset.value.segments.length <= 1) {
    toast.warning('至少保留一个段')
    return
  }
  activePreset.value.segments = activePreset.value.segments.filter((s) => s.id !== id)
}

function cycleRole(seg: PromptSegment) {
  const idx = roles.indexOf(seg.role)
  seg.role = roles[(idx + 1) % roles.length]!
}

function globalIndex(segIdx: number): number {
  return segIdx + 1
}

function save() {
  store.save()
}

function saveAll() {
  const p = activePreset.value
  if (p) {
    if (!p.name.trim()) {
      toast.error('预设名称不能为空')
      return
    }
    for (const s of p.segments) {
      if (!s.name.trim()) {
        toast.error('段名称不能为空')
        return
      }
    }
  }
  save()
  toast.success('已保存')
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

const previewVisible = ref(false)
const previewJson = ref('')

async function openPreview() {
  save()
  if (!session.isChatActive()) {
    toast.warning('请先进入对话再预览（预览需读取对话与世界书数据）')
    return
  }
  const conversationText = session.getConversationText(10)
  const worldbookContent = await session.getWorldbookPreview(conversationText)
  const personaDescription = session.getPersonaDescription()
  const charDescription = session.getCharDescription()
  const lastUserMsg = session.getLastUserMessage()
  const values = buildVarValues()
  const realValues: Record<string, string> = {
    ...values,
    worldbook: worldbookContent,
    conversation: conversationText,
    persona: personaDescription,
    charDescription: charDescription,
    userInput: lastUserMsg || values.userInput
  }
  if (activeScene.value === 'chronicleRecall') {
    try {
      const result = session.getTableRowsWithRowid('cn_chronicle')
      const rows = result[0]?.rows ?? []
      if (rows.length > 0) {
        const cDef = store.config.chronicleTableDef ?? DEFAULT_CHRONICLE_TABLE
        const kKey = cDef.columns.find((c) => c.role === 'key')?.name
        const kSummary = cDef.columns.find((c) => c.role === 'summary')?.name
        realValues.chronicleList = JSON.stringify(
          rows.map((r) => ({
            key: kKey ? String((r as Record<string, unknown>)[kKey] ?? '') : '',
            summary: kSummary ? String((r as Record<string, unknown>)[kSummary] ?? '') : ''
          })),
          null,
          2
        )
      }
    } catch {}
  }
  const segs = activePreset.value?.segments ?? []
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

const previewTemplateVisible = ref(false)
const previewTemplateJson = ref('')

function openTemplatePreview() {
  if (!selectedTable.value) return
  const t = selectedTable.value
  const lines: string[] = []
  lines.push(`-- 表: ${t.displayName} (${t.name})`)
  try {
    lines.push(`-- DDL:`)
    lines.push(`-- ${buildCreateTableSql(t).replace(/\n/g, '\n-- ')}`)
  } catch (e) {
    lines.push(`-- DDL 生成失败: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (t.note) lines.push(`-- Note: ${t.note.replace(/\n/g, '\n-- ')}`)
  if (t.insertHint) lines.push(`-- INSERT 提示: ${t.insertHint.replace(/\n/g, '\n-- ')}`)
  if (t.updateHint) lines.push(`-- UPDATE 提示: ${t.updateHint.replace(/\n/g, '\n-- ')}`)
  if (t.deleteHint) lines.push(`-- DELETE 提示: ${t.deleteHint.replace(/\n/g, '\n-- ')}`)
  for (const col of t.columns) {
    if (col.note) {
      lines.push(`-- 列 ${col.displayName}(${col.name}): ${col.note.replace(/\n/g, '\n-- ')}`)
    }
  }
  lines.push(`-- 当前数据: 模板预览不读取实际数据`)
  previewTemplateJson.value = lines.join('\n')
  previewTemplateVisible.value = true
}

function closeTemplatePreview() {
  previewTemplateVisible.value = false
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
      const raw = JSON.parse(String(reader.result)) as Record<string, unknown>
      let segments: PromptSegment[]
      if (Array.isArray(raw.segments)) {
        segments = (raw.segments as PromptSegment[]).map((s) => ({
          id: typeof s.id === 'string' ? s.id : newId('seg'),
          name: typeof s.name === 'string' ? s.name : '',
          role: s.role,
          content: s.content
        }))
      } else if (Array.isArray(raw.blocks)) {
        segments = []
        for (const b of raw.blocks as { name: string; segments: PromptSegment[] }[]) {
          for (const s of b.segments) {
            segments.push({
              id: s.id || newId('seg'),
              name: b.name,
              role: s.role,
              content: s.content
            })
          }
        }
      } else {
        throw new Error('格式不符（需要 segments 或 blocks 字段）')
      }
      const parsed: ScenePreset = {
        id: newId('preset'),
        name: typeof raw.name === 'string' ? raw.name : '导入预设',
        segments
      }
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
const promptTabs = [
  { key: 'template', label: '表格模板', icon: 'fa-table' },
  { key: 'prompt', label: '提示词配置', icon: 'fa-pen-to-square' }
]
const promptTabValue = computed({
  get: () => (showTemplate.value ? 'template' : 'prompt'),
  set: (v: string) => {
    showTemplate.value = v === 'template'
  }
})
const sceneTabValue = computed({
  get: () => activeScene.value,
  set: (v: string) => {
    activeScene.value = v as PromptSceneKey
  }
})
const COL_TYPES = ['TEXT', 'INTEGER', 'REAL', 'BLOB']

function freshTable(): TableDef {
  return {
    name: '',
    displayName: '',
    columns: [],
    note: '',
    insertHint: '',
    updateHint: '',
    deleteHint: '',
    exportConfig: {
      enabled: true,
      entryType: 'constant',
      splitByRow: false,
      keywordColumn: '',
      keywords: '',
      keywordMode: 'custom',
      keywordAiPrompt: ''
    }
  }
}

function setExportEnabled(table: TableDef, checked: boolean) {
  ensureExportConfig(table)
  table.exportConfig!.enabled = checked
}

function setExportEntryType(table: TableDef, value: string) {
  ensureExportConfig(table)
  table.exportConfig!.entryType = value as 'constant' | 'keyword'
}

function setExportKeywords(table: TableDef, value: string) {
  ensureExportConfig(table)
  table.exportConfig!.keywords = value
}

function setExportKeywordMode(table: TableDef, value: string) {
  ensureExportConfig(table)
  table.exportConfig!.keywordMode = value as 'custom' | 'ai_prompt'
}

function setExportKeywordAiPrompt(table: TableDef, value: string) {
  ensureExportConfig(table)
  table.exportConfig!.keywordAiPrompt = value
}

function ensureExportConfig(table: TableDef) {
  if (!table.exportConfig) {
    table.exportConfig = {
      enabled: true,
      entryType: 'constant',
      splitByRow: false,
      keywordColumn: '',
      keywords: '',
      keywordMode: 'custom',
      keywordAiPrompt: ''
    }
  }
}

function freshColumn(): ColumnDef {
  return { name: '', displayName: '', type: 'TEXT' }
}

const ttConfig = computed(() => store.config.tableTemplate)

const activeTemplatePreset = computed(
  () =>
    ttConfig.value.presets.find((p) => p.id === ttConfig.value.activeId) ??
    ttConfig.value.presets[0]
)

const editingTables = computed(() => activeTemplatePreset.value?.template?.tables ?? [])

const selectedTableIdx = ref(-1)

const selectedTable = computed(() => {
  const tables = editingTables.value
  if (selectedTableIdx.value < 0 || selectedTableIdx.value >= tables.length) return null
  return tables[selectedTableIdx.value]
})

const selectedView = ref<'preset' | 'chronicle'>('preset')

const CHRONICLE_ROLES: ChronicleColumnRole[] = [
  'key',
  'timeStart',
  'timeEnd',
  'location',
  'summary',
  'keyDialogue'
]
const CHRONICLE_ROLE_LABELS: Record<ChronicleColumnRole, string> = {
  key: '编码',
  timeStart: '起始时间',
  timeEnd: '结束时间',
  location: '地点',
  summary: '纪要正文',
  keyDialogue: '重要台词'
}

const chronicleDef = computed(() => store.config.chronicleTableDef ?? DEFAULT_CHRONICLE_TABLE)

function syncChronicleTableDef() {
  if (!store.config.chronicleTableDef) {
    store.config.chronicleTableDef = JSON.parse(JSON.stringify(DEFAULT_CHRONICLE_TABLE))
  }
}

function addChronicleColumn() {
  chronicleDef.value.columns.push(freshColumn())
}

function removeChronicleColumn(idx: number) {
  if (chronicleDef.value.columns.length <= 1) {
    toast.warning('至少保留一个列')
    return
  }
  chronicleDef.value.columns.splice(idx, 1)
}

function validateTableDef(table: TableDef, allTables: TableDef[]): string | null {
  if (!table.name.trim()) return '英文表名不能为空'
  if (!table.displayName.trim()) return '中文表名不能为空'
  if (table.columns.length === 0) return '至少需要一列'
  const nameSet = new Set<string>()
  for (const col of table.columns) {
    if (!col.name.trim()) return `表「${table.displayName || table.name}」有列英文名为空`
    if (!col.displayName.trim()) return `表「${table.displayName || table.name}」有列中文名为空`
    if (nameSet.has(col.name.trim()))
      return `表「${table.displayName || table.name}」列英文名重复：${col.name.trim()}`
    nameSet.add(col.name.trim())
  }
  if (table.exportConfig?.entryType === 'keyword' && !table.exportConfig.keywords?.trim()) {
    return `表「${table.displayName || table.name}」关键词注入模式下，触发关键词不能为空`
  }
  const dup = allTables.filter((t) => t !== table && t.name.trim() === table.name.trim())
  if (dup.length > 0) return `表英文名重复：${table.name.trim()}`
  return null
}

function validateChronicleDef(def: TableDef): string | null {
  const nameSet = new Set<string>()
  for (const col of def.columns) {
    if (!col.name.trim()) return '列英文名不能为空'
    if (!col.displayName.trim()) return '列中文名不能为空'
    if (!col.note?.trim()) return `列「${col.displayName || col.name}」的列说明不能为空`
    if (nameSet.has(col.name.trim())) return `列英文名重复：${col.name.trim()}`
    nameSet.add(col.name.trim())
  }
  const roleCounts = new Map<ChronicleColumnRole, number>()
  for (const col of def.columns) {
    if (col.role) {
      roleCounts.set(col.role, (roleCounts.get(col.role) ?? 0) + 1)
    }
  }
  const requiredRoles: ChronicleColumnRole[] = [
    'key',
    'timeStart',
    'timeEnd',
    'location',
    'summary',
    'keyDialogue'
  ]
  const missing = requiredRoles.filter((r) => !roleCounts.has(r))
  const duplicated = [...roleCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([r]) => CHRONICLE_ROLE_LABELS[r])
  if (missing.length === 0 && duplicated.length === 0) {
    return null
  }
  const parts: string[] = []
  if (missing.length > 0) {
    parts.push(`缺少角色: ${missing.map((r) => CHRONICLE_ROLE_LABELS[r]).join('、')}`)
  }
  if (duplicated.length > 0) {
    parts.push(`角色重复: ${duplicated.join('、')}`)
  }
  return parts.join('；') + '。6 个语义角色必须各有且仅有一列持有。'
}

async function saveChronicleTableDef() {
  const err = validateChronicleDef(chronicleDef.value)
  if (err) {
    toast.error(err)
    return
  }
  let hasData = false
  try {
    hasData = (session.getTableRowsWithRowid('cn_chronicle')[0]?.rows?.length ?? 0) > 0
  } catch {
    hasData = false
  }
  if (hasData) {
    const ok = await confirm(
      '保存纪要表',
      '保存后将按新结构重建纪要表：同名列数据迁移保留，删改列名的列数据丢失，结构立即生效。继续？',
      '保存并重建',
      true
    )
    if (!ok) return
  }
  try {
    await session.applyChronicleTableDef(JSON.parse(JSON.stringify(chronicleDef.value)))
    store.reload()
    toast.success(hasData ? '纪要表已保存并重建' : '纪要表已保存')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
  }
}

function selectChronicle() {
  selectedView.value = 'chronicle'
}

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
  const CARD_PRESET_ID = '__card__'
  const existingIdx = ttConfig.value.presets.findIndex((p) => p.id === CARD_PRESET_ID)
  if (existingIdx >= 0) {
    ttConfig.value.presets.splice(existingIdx, 1)
  }
  if (session.getCurrentTemplateId() !== '__card__') {
    if (ttConfig.value.activeId === CARD_PRESET_ID) {
      ttConfig.value.activeId = ttConfig.value.presets[0]?.id ?? ''
    }
    if (ttConfig.value.defaultId === CARD_PRESET_ID) {
      ttConfig.value.defaultId = ttConfig.value.presets[0]?.id ?? ''
    }
    store.save()
    return
  }
  const fromCard = session.getTemplate()
  if (!fromCard || !Array.isArray(fromCard.tables) || fromCard.tables.length === 0) return
  const cardPreset = {
    id: CARD_PRESET_ID,
    name: '当前角色卡',
    template: JSON.parse(JSON.stringify(fromCard)),
    source: 'card' as const
  }
  ttConfig.value.presets.unshift(cardPreset)
  if (!ttConfig.value.defaultId) {
    ttConfig.value.defaultId = CARD_PRESET_ID
  }
  store.save()
}

async function selectPresetT(id: string) {
  selectedView.value = 'preset'
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

  const tables = session
    .listTables()
    .filter((n) => n !== 'cn_chronicle' && !n.startsWith('sqlite_'))
  const hasData = tables.some((t) => (session.getTableRowsWithRowid(t)[0]?.rows?.length ?? 0) > 0)
  if (hasData) {
    const ok = await confirm(
      '⚠️ 数据丢失风险',
      `当前已有数据。切换模板将删除所有表及其数据，且不可撤销。\n\n确定要切换吗？`,
      '删除数据并切换',
      true
    )
    if (!ok) return
  }

  try {
    await session.reinitWithTemplate(target.template, target.id)
    ttConfig.value.activeId = id
    selectedTableIdx.value = -1
    store.save()
    toast.success('已切换到模板：' + target.name)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
  }
}

async function deletePresetT(id: string) {
  if (ttConfig.value.presets.length <= 1) {
    toast.warning('至少保留一个预设')
    return
  }
  const target = ttConfig.value.presets.find((p) => p.id === id)
  if (!target) return
  if (target.source === 'card' || target.source === 'builtin') {
    toast.warning('内置模板不可删除')
    return
  }
  const ok = await confirm(
    '删除确认',
    `确认删除模板预设「${target.name}」？此操作不可撤销。`,
    '删除',
    true
  )
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
  const ok = await confirm(
    '删除确认',
    `确认删除表「${t.displayName || t.name || '(未命名)'}」？`,
    '删除',
    true
  )
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

async function saveTemplate() {
  if (selectedView.value === 'chronicle') {
    await saveChronicleTableDef()
    return
  }
  const tables = activeTemplatePreset.value?.template.tables ?? []
  for (const t of tables) {
    const err = validateTableDef(t, tables)
    if (err) {
      toast.error(err)
      return
    }
  }
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
  if (selectedView.value === 'chronicle') {
    const err = validateChronicleDef(chronicleDef.value)
    if (err) {
      toast.error(err)
      return
    }
    const data = JSON.stringify(chronicleDef.value, null, 2)
    downloadJson(data, `纪要表_${chronicleDef.value.name}.json`)
    return
  }
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
  syncChronicleTableDef()
})
</script>

<template>
  <div class="prompt-page">
    <div class="prompt-wrap cn-card">
      <!-- ═══ 顶层 Tab：表格模板 / 提示词配置 ═══ -->
      <div class="prompt-head">
        <CNTabs level="l1" :items="promptTabs" v-model="promptTabValue" />
        <CNTabs v-if="!showTemplate" level="l1" :items="scenes" v-model="sceneTabValue" />
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
            <TransitionGroup tag="ul" class="preset-list">
              <li
                v-for="p in ttConfig.presets"
                :key="p.id"
                class="preset-list__item"
                :class="{
                  'preset-list__item--active':
                    p.id === ttConfig.activeId && selectedView === 'preset'
                }"
                @click="selectPresetT(p.id)"
              >
                <span class="preset-list__name">
                  <i
                    v-if="p.source === 'card'"
                    class="fa-solid fa-id-card preset-list__card"
                    title="角色卡自带模板"
                  ></i>
                  {{ p.name }}
                  <i
                    v-if="p.id === ttConfig.defaultId"
                    class="fa-solid fa-star preset-list__default"
                    title="默认预设"
                  ></i>
                </span>
                <span class="preset-list__count">{{ p.template.tables.length }}表</span>
                <button
                  v-if="p.id !== ttConfig.activeId"
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="设为当前"
                  @click.stop="selectPresetT(p.id)"
                >
                  <i class="fa-solid fa-check"></i>
                </button>
                <button
                  v-if="p.id !== ttConfig.defaultId"
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="设为默认"
                  @click.stop="setDefaultPresetT(p.id)"
                >
                  <i class="fa-solid fa-star"></i>
                </button>
                <button
                  v-if="p.source !== 'card'"
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="删除"
                  @click.stop="deletePresetT(p.id)"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </li>
            </TransitionGroup>
          </div>
          <div class="prompt-side__chronicle">
            <div
              class="preset-list__item preset-list__item--chronicle"
              :class="{ 'preset-list__item--active': selectedView === 'chronicle' }"
              @click="selectChronicle"
            >
              <span class="preset-list__name">
                <i class="fa-solid fa-clock-rotate-left preset-list__card"></i>
                纪要表
                <i
                  class="fa-solid fa-circle-info"
                  style="color: var(--cn-text-3); font-size: 11px"
                  title="系统内置，结构可编辑"
                ></i>
              </span>
              <span class="preset-list__count">内置</span>
            </div>
          </div>
        </div>

        <!-- 右侧：选中模板的全部表 -->
        <div class="prompt-editor" v-if="selectedView === 'chronicle'">
          <div class="cn-card__head">
            <span>纪要表（系统内置）</span>
            <span class="prompt-editor__desc"
              >结构可编辑；保存后按新结构重建表（同名列数据迁移）。表名固定不可改。</span
            >
            <button class="cn-btn cn-btn--sm cn-btn--primary" @click="saveChronicleTableDef">
              <i class="fa-solid fa-save"></i>
              保存并重建
            </button>
          </div>
          <div class="cn-card__body template-editor-body">
            <div class="tpl-table-card tpl-table-card--active">
              <div class="tpl-table-card__head">
                <span class="tpl-table-card__name"
                  >{{ chronicleDef.displayName }} ({{ chronicleDef.name }})</span
                >
                <span class="tpl-table-card__meta">{{ chronicleDef.columns.length }}列·内置</span>
              </div>
              <div class="tpl-table-card__body">
                <div class="tpl-row">
                  <div class="tpl-field">
                    <label class="tpl-label">英文表名（锁定）</label>
                    <input class="cn-input" :value="chronicleDef.name" disabled />
                  </div>
                  <div class="tpl-field">
                    <label class="tpl-label">中文表名</label>
                    <input
                      class="cn-input"
                      v-model="chronicleDef.displayName"
                      placeholder="给 AI 看的表名"
                    />
                  </div>
                </div>
                <div class="tpl-section">
                  <label class="tpl-label">表说明 (note)</label>
                  <textarea
                    class="cn-textarea tpl-textarea"
                    v-model="chronicleDef.note"
                    rows="3"
                    placeholder="表的用途与每列填写约束（经 tables 占位符注入 AI prompt）"
                  ></textarea>
                </div>
                <div class="tpl-section">
                  <div class="tpl-section__head">
                    <label class="tpl-label">列定义</label>
                    <button class="cn-btn cn-btn--sm" @click="addChronicleColumn">
                      <i class="fa-solid fa-plus"></i>添加列
                    </button>
                  </div>
                  <div class="tpl-cols">
                    <div class="tpl-col-head">
                      <span class="tpl-col-cell name">英文名</span>
                      <span class="tpl-col-cell name">中文名</span>
                      <span class="tpl-col-cell type">类型</span>
                      <span class="tpl-col-cell flags">约束</span>
                      <span class="tpl-col-cell role">语义角色</span>
                      <span class="tpl-col-cell note">AI 提示</span>
                      <span class="tpl-col-cell del"></span>
                    </div>
                    <div v-for="(col, ci) in chronicleDef.columns" :key="ci" class="tpl-col-row">
                      <input
                        class="cn-input tpl-col-cell name"
                        v-model="col.name"
                        placeholder="col_name"
                      />
                      <input
                        class="cn-input tpl-col-cell name"
                        v-model="col.displayName"
                        placeholder="中文名"
                      />
                      <select class="cn-select tpl-col-cell type" v-model="col.type">
                        <option v-for="t in COL_TYPES" :key="t" :value="t">{{ t }}</option>
                      </select>
                      <span class="tpl-col-cell flags">
                        <button
                          class="cn-btn cn-btn--xs"
                          :class="{ 'cn-btn--primary': col.constraints?.primaryKey }"
                          title="主键"
                          @click="toggleConstraint(col, 'primaryKey')"
                        >
                          PK
                        </button>
                        <button
                          class="cn-btn cn-btn--xs"
                          :class="{ 'cn-btn--primary': col.constraints?.unique }"
                          title="唯一"
                          @click="toggleConstraint(col, 'unique')"
                        >
                          UQ
                        </button>
                        <button
                          class="cn-btn cn-btn--xs"
                          :class="{ 'cn-btn--primary': !col.constraints?.nullable }"
                          title="非空"
                          @click="toggleConstraint(col, 'nullable')"
                        >
                          NN
                        </button>
                      </span>
                      <select class="cn-select tpl-col-cell role" v-model="col.role">
                        <option :value="undefined">无</option>
                        <option v-for="r in CHRONICLE_ROLES" :key="r" :value="r">
                          {{ CHRONICLE_ROLE_LABELS[r] }}
                        </option>
                      </select>
                      <input
                        class="cn-input tpl-col-cell note"
                        v-model="col.note"
                        placeholder="列说明（注入 AI prompt）"
                      />
                      <button
                        class="cn-btn cn-btn--sm cn-btn--text tpl-col-cell del"
                        title="删除列"
                        @click="removeChronicleColumn(ci)"
                      >
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                </div>
                <div class="tpl-section">
                  <label class="tpl-label">新增行提示 (insertHint)</label>
                  <textarea
                    class="cn-textarea tpl-textarea"
                    v-model="chronicleDef.insertHint"
                    rows="4"
                    placeholder="INSERT 时机/格式/SQL示例（注入 AI prompt）"
                  ></textarea>
                </div>
                <div class="tpl-section">
                  <label class="tpl-label">更新行提示 (updateHint)</label>
                  <textarea
                    class="cn-textarea tpl-textarea"
                    v-model="chronicleDef.updateHint"
                    rows="2"
                    placeholder="UPDATE 时机/约束（注入 AI prompt）"
                  ></textarea>
                </div>
                <div class="tpl-section">
                  <label class="tpl-label">删除行提示 (deleteHint)</label>
                  <textarea
                    class="cn-textarea tpl-textarea"
                    v-model="chronicleDef.deleteHint"
                    rows="2"
                    placeholder="DELETE 时机/约束（注入 AI prompt）"
                  ></textarea>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="prompt-editor" v-else-if="activeTemplatePreset">
          <div class="cn-card__head">
            <input
              class="cn-input"
              style="width: 200px; font-weight: 600"
              v-model="activeTemplatePreset.name"
              placeholder="模板名称"
            />
            <button class="cn-btn cn-btn--sm" @click="addTableT">
              <i class="fa-solid fa-plus"></i>添加表
            </button>
            <button class="cn-btn cn-btn--sm" v-if="selectedTable" @click="openTemplatePreview">
              <i class="fa-solid fa-eye"></i>预览此表
            </button>
          </div>
          <div class="cn-card__body template-editor-body">
            <div v-if="editingTables.length === 0" class="template-editor-empty">
              <span>此模板尚无数据表，点击"添加表"开始</span>
            </div>
            <div
              v-for="(table, ti) in editingTables"
              :key="ti"
              class="tpl-table-card"
              :class="{ 'tpl-table-card--active': ti === selectedTableIdx }"
            >
              <div
                class="tpl-table-card__head"
                @click="selectedTableIdx = selectedTableIdx === ti ? -1 : ti"
              >
                <span class="tpl-table-card__name">{{
                  table.displayName || table.name || '(未命名)'
                }}</span>
                <span class="tpl-table-card__meta">{{ table.columns.length }}列</span>
                <button
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="删除表"
                  @click.stop="removeTableT(ti)"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
              <Transition name="cn-fold">
                <div v-if="ti === selectedTableIdx" class="tpl-table-card__body">
                  <div class="tpl-row">
                    <div class="tpl-field">
                      <label class="tpl-label">英文表名</label>
                      <input class="cn-input" v-model="table.name" placeholder="snake_case" />
                    </div>
                    <div class="tpl-field">
                      <label class="tpl-label">中文表名</label>
                      <input
                        class="cn-input"
                        v-model="table.displayName"
                        placeholder="给 AI 看的表名"
                      />
                    </div>
                  </div>
                  <div class="tpl-section">
                    <label class="tpl-label">表说明 (note)</label>
                    <textarea
                      class="cn-textarea tpl-textarea"
                      v-model="table.note"
                      rows="2"
                      placeholder="表的用途与每列填写约束（经 tables 占位符注入 AI prompt）"
                    ></textarea>
                  </div>
                  <div class="tpl-section">
                    <label class="tpl-label">世界书注入</label>
                    <div class="tpl-row" style="align-items: center">
                      <div
                        class="tpl-field"
                        style="flex-direction: row; align-items: center; gap: 8px"
                      >
                        <label class="tpl-label" style="font-size: 12px">启用注入</label>
                        <label class="cn-switch">
                          <input
                            type="checkbox"
                            :checked="table.exportConfig?.enabled !== false"
                            @change="setExportEnabled(table, ($event.target as HTMLInputElement).checked)"
                          />
                          <span class="cn-switch__track"></span>
                        </label>
                      </div>
                      <div class="tpl-field">
                        <label class="tpl-label" style="font-size: 12px">注入类型</label>
                        <select
                          class="cn-select"
                          style="width: auto"
                          @change="setExportEntryType(table, ($event.target as HTMLSelectElement).value)"
                        >
                          <option
                            value="constant"
                            :selected="(table.exportConfig?.entryType ?? 'constant') === 'constant'"
                          >
                            常量（始终注入）
                          </option>
                          <option
                            value="keyword"
                            :selected="table.exportConfig?.entryType === 'keyword'"
                          >
                            关键词（召回触发）
                          </option>
                        </select>
                      </div>
                    </div>
                    <div
                      v-if="table.exportConfig?.entryType === 'keyword'"
                      class="tpl-row"
                      style="margin-top: 8px; flex-direction: column; align-items: stretch"
                    >
                      <div class="tpl-field">
                        <label class="tpl-label" style="font-size: 12px">关键词来源</label>
                        <select
                          class="cn-select"
                          style="width: auto"
                          @change="setExportKeywordMode(table, ($event.target as HTMLSelectElement).value)"
                        >
                          <option
                            value="custom"
                            :selected="(table.exportConfig?.keywordMode ?? 'custom') === 'custom'"
                          >
                            自定义关键词
                          </option>
                          <option
                            value="ai_prompt"
                            :selected="table.exportConfig?.keywordMode === 'ai_prompt'"
                          >
                            AI Prompt 生成
                          </option>
                        </select>
                      </div>
                      <div
                        v-if="(table.exportConfig?.keywordMode ?? 'custom') === 'custom'"
                        class="tpl-field"
                      >
                        <label class="tpl-label" style="font-size: 12px">触发关键词</label>
                        <input
                          class="cn-input"
                          :value="table.exportConfig?.keywords ?? ''"
                          @input="setExportKeywords(table, ($event.target as HTMLInputElement).value)"
                          placeholder="逗号分隔，如：背包, 物品, 装备"
                        />
                      </div>
                      <div v-else class="tpl-field">
                        <label class="tpl-label" style="font-size: 12px">AI 提示词（更新表格时发送）</label>
                        <textarea
                          class="cn-textarea tpl-textarea"
                          :value="table.exportConfig?.keywordAiPrompt ?? ''"
                          @input="setExportKeywordAiPrompt(table, ($event.target as HTMLTextAreaElement).value)"
                          rows="2"
                          placeholder="更新表格时发送给 AI，由 AI 决定本表世界书条目的触发关键词，如：请根据背包表内容生成可能触发该表注入的关键词"
                        ></textarea>
                      </div>
                    </div>
                  </div>
                  <div class="tpl-section">
                    <div class="tpl-section__head">
                      <label class="tpl-label">列定义</label>
                      <button class="cn-btn cn-btn--sm" @click="addColumnT">
                        <i class="fa-solid fa-plus"></i>添加列
                      </button>
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
                        <input
                          class="cn-input tpl-col-cell name"
                          v-model="col.name"
                          placeholder="col_name"
                        />
                        <input
                          class="cn-input tpl-col-cell name"
                          v-model="col.displayName"
                          placeholder="中文名"
                        />
                        <select class="cn-select tpl-col-cell type" v-model="col.type">
                          <option v-for="t in COL_TYPES" :key="t" :value="t">{{ t }}</option>
                        </select>
                        <span class="tpl-col-cell flags">
                          <button
                            class="cn-btn cn-btn--xs"
                            :class="{ 'cn-btn--primary': col.constraints?.primaryKey }"
                            title="主键"
                            @click="toggleConstraint(col, 'primaryKey')"
                          >
                            PK
                          </button>
                          <button
                            class="cn-btn cn-btn--xs"
                            :class="{ 'cn-btn--primary': col.constraints?.unique }"
                            title="唯一"
                            @click="toggleConstraint(col, 'unique')"
                          >
                            UQ
                          </button>
                          <button
                            class="cn-btn cn-btn--xs"
                            :class="{ 'cn-btn--primary': !col.constraints?.nullable }"
                            title="非空"
                            @click="toggleConstraint(col, 'nullable')"
                          >
                            NN
                          </button>
                        </span>
                        <input
                          class="cn-input tpl-col-cell note"
                          v-model="col.note"
                          placeholder="列说明（注入 AI prompt）"
                        />
                        <button
                          class="cn-btn cn-btn--sm cn-btn--text tpl-col-cell del"
                          title="删除列"
                          @click="removeColumnT(ci)"
                        >
                          <i class="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div class="tpl-section">
                    <label class="tpl-label">新增行提示 (insertHint)</label>
                    <textarea
                      class="cn-textarea tpl-textarea"
                      v-model="table.insertHint"
                      rows="2"
                      placeholder="INSERT 时机/格式/SQL示例（注入 AI prompt）"
                    ></textarea>
                  </div>
                  <div class="tpl-section">
                    <label class="tpl-label">更新行提示 (updateHint)</label>
                    <textarea
                      class="cn-textarea tpl-textarea"
                      v-model="table.updateHint"
                      rows="2"
                      placeholder="UPDATE 时机/约束（注入 AI prompt）"
                    ></textarea>
                  </div>
                  <div class="tpl-section">
                    <label class="tpl-label">删除行提示 (deleteHint)</label>
                    <textarea
                      class="cn-textarea tpl-textarea"
                      v-model="table.deleteHint"
                      rows="2"
                      placeholder="DELETE 时机/约束（注入 AI prompt）"
                    ></textarea>
                  </div>
                </div>
              </Transition>
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
              <TransitionGroup tag="ul" class="preset-list">
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
                  <span class="preset-list__count">{{ p.segments.length }}段</span>
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
              </TransitionGroup>
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
                :list="activePreset?.segments ?? []"
                item-key="id"
                :animation="150"
                handle=".seg-item__grip"
                ghost-class="seg-item--ghost"
                class="block-list"
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
                      <input
                        class="cn-input seg-item__name"
                        v-model="seg.name"
                        placeholder="段名称"
                      />
                      <span class="seg-item__seq">#{{ globalIndex(si) }}</span>
                      <button
                        class="cn-btn cn-btn--sm cn-btn--text"
                        title="删除"
                        @click="removeSegment(seg.id)"
                      >
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    </div>
                    <PromptSegmentEditor v-model="seg.content" />
                  </div>
                </template>
              </draggable>
              <div class="seg-add-row">
                <button
                  v-for="r in roles"
                  :key="r"
                  class="cn-btn cn-btn--sm"
                  @click="addSegment(r)"
                >
                  <i class="fa-solid fa-plus"></i>
                  {{ roleLabels[r] }}
                </button>
              </div>
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

    <Transition name="cn-modal">
      <div v-if="previewTemplateVisible" class="cn-modal-mask" @click.self="closeTemplatePreview">
        <div class="cn-modal">
          <div class="cn-modal__head">
            <span>选中表注入 AI prompt 的内容</span>
            <button class="cn-btn cn-btn--sm cn-btn--text" @click="closeTemplatePreview">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <pre class="cn-modal__code">{{ previewTemplateJson }}</pre>
        </div>
      </div>
    </Transition>

    <template v-if="!showTemplate">
      <div class="prompt-foot">
        <span class="prompt-foot__hint">
          段内用 <code>{{ varExample }}</code> 插入变量。点击角色标签切换
          System/User/Assistant，拖拽手柄调整顺序。多个段按顺序拼接，模拟多轮对话。
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

      <Transition name="cn-modal">
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
      </Transition>
    </template>
  </div>
</template>
