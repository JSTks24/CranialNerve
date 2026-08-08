<script setup lang="ts">
import { ref, computed, onActivated, onMounted, onBeforeUnmount } from 'vue'
import { useConfigStore } from '@ui/stores/config'
import { getSession } from '@core/session'
import type { PromptRole, PromptSceneKey, PromptSegment, ScenePreset } from '@shared/types/config'
import type {
  TableDef,
  ColumnDef,
  TablePlacementPosition
} from '@shared/types/table'
import type { CardTemplate } from '@shared/types/card'
import {
  isShujukuTemplate,
  convertShujukuToCardTemplate,
  isCardTemplate,
  createUserTemplatePreset
} from '@shared/template-convert'
import { buildCreateTableSql } from '@shared/template-builder'
import { SQL_EDIT_FORMAT } from '@shared/constants/sql-json'
import {
  createDefaultPreset,
  getDefaultTableEditPrompt,
  getDefaultChronicleRecallPrompt
} from '@shared/prompts/defaults'
import { interpolate } from '@shared/prompts/interpolate'
import toast from '@ui/toast'
import confirm, { promptRename } from '@ui/dialog'
import PromptBlockEditor from '@ui/components/PromptBlockEditor.vue'
import CNTabs from '@ui/components/CNTabs.vue'
import VariableHelpModal from '@ui/components/VariableHelpModal.vue'
import PresetSourceModal from '@ui/components/PresetSourceModal.vue'
import { CHRONICLE_TABLE_NAME, CHRONICLE_COLUMNS } from '@shared/constants/chronicle'
import { validateTableDef, validateChronicleDef } from '@shared/table-validation'
import { PROMPT_VARIABLES } from '@shared/constants'

const session = getSession()
const store = useConfigStore()
const config = computed(() => store.config.prompt)

const scenes = (Object.keys(PROMPT_VARIABLES) as PromptSceneKey[]).map((key) => ({
  key,
  label: PROMPT_VARIABLES[key].label
}))

const activeScene = ref<PromptSceneKey>('tableEdit')
const varExample = '{{变量名}}'

const newPresetVisible = ref(false)
const newPresetTVisible = ref(false)

const defaultTemplateAvailable = computed(() => !!session.getDefaultTemplate())

const defaultPromptAvailable = computed(
  () =>
    (activeScene.value === 'chronicleRecall'
      ? getDefaultChronicleRecallPrompt()
      : getDefaultTableEditPrompt()
    ).length > 0
)

const sceneConfig = computed(() => config.value[activeScene.value])
const selectedScenePresetId = ref<string | null>(null)
const activePreset = computed(
  () =>
    sceneConfig.value.presets.find((p) => p.id === selectedScenePresetId.value) ??
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

function handleNewPreset(mode: 'blank' | 'default') {
  newPresetVisible.value = false
  let p: ScenePreset
  if (mode === 'blank') {
    p = {
      id: newId('preset'),
      name: `预设 ${sceneConfig.value.presets.length + 1}`,
      segments: [{ id: newId('seg'), name: '主指令', role: 'system', content: '' }]
    }
  } else {
    p = createDefaultPreset(activeScene.value)
  }
  sceneConfig.value.presets.push(p)
  sceneConfig.value.activeId = p.id
  selectedScenePresetId.value = p.id
  save()
  toast.success(mode === 'blank' ? '已新建预设' : '已从默认提示词创建')
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
  if (selectedScenePresetId.value === id) selectedScenePresetId.value = null
  save()
  toast.success('已删除')
}

function setDefaultPreset(id: string) {
  sceneConfig.value.defaultId = id
  save()
  toast.success('已设为默认')
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
    chronicleTable: '（当前无纪要表数据）',
    chronicleList: '（当前无纪要）'
  }
  if (activeScene.value === 'tableEdit') {
    const tables = session.listTables().filter((n) => n !== CHRONICLE_TABLE_NAME && !n.startsWith('sqlite_'))
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
  if (activeScene.value === 'chronicleGen') {
    try {
      const result = session.getTableRowsWithRowid(CHRONICLE_TABLE_NAME)
      const rows = result[0]?.rows ?? []
      values.chronicleTable = `-- 纪要表: cn_chronicle\n-- 当前数据 (${rows.length} 行):\n${JSON.stringify(rows)}`
    } catch {}
  }
  return values
}

const varHelpVisible = ref(false)
const previewVisible = ref(false)
const previewJson = ref('')

async function openPreview() {
  const prog = toast.progress('正在生成预览中…')
  await new Promise((r) => setTimeout(r, 0))
  save()
  if (!session.isChatActive()) {
    prog.close()
    toast.warning('请先进入对话再预览（预览需读取对话与世界书数据）')
    return
  }
  try {
    const conversationText = session.getConversationText(10)
    const worldbookContent = await Promise.race([
      session.getWorldbookPreview(conversationText),
      new Promise<string>((_, reject) => {
        prog.abortSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    ])
    if (prog.abortSignal.aborted) {
      prog.close()
      return
    }
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
          const kKey = CHRONICLE_COLUMNS.key
          const kSummary = CHRONICLE_COLUMNS.summary
          realValues.chronicleList = JSON.stringify(
            rows.map((r) => ({
              key: String((r as Record<string, unknown>)[kKey] ?? ''),
              summary: String((r as Record<string, unknown>)[kSummary] ?? '')
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
    prog.close()
    toast.success('生成成功')
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      prog.close()
    } else {
      prog.close()
      toast.error(e instanceof Error ? e.message : '预览失败')
    }
  }
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
      keywordColumn: '',
      keywordMode: 'custom'
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

function setExportKeywordMode(table: TableDef, value: string) {
  ensureExportConfig(table)
  table.exportConfig!.keywordMode = value as 'custom' | 'ai_prompt'
}

function setExportKeywordColumn(table: TableDef, value: string) {
  ensureExportConfig(table)
  table.exportConfig!.keywordColumn = value
}

function setExportPlacementPosition(table: TableDef, value: string) {
  ensureExportConfig(table)
  ensureEntryPlacement(table)
  table.exportConfig!.entryPlacement!.position = value as TablePlacementPosition
}

function isAtDepthPosition(position: string | undefined): boolean {
  return position === 'at_depth_as_system' || position === 'at_depth_as_user' || position === 'at_depth_as_assistant'
}

function setExportPlacementDepth(table: TableDef, value: string) {
  ensureExportConfig(table)
  ensureEntryPlacement(table)
  const n = parseInt(value, 10)
  table.exportConfig!.entryPlacement!.depth = Number.isFinite(n) ? n : 2
}

function setExportPlacementOrder(table: TableDef, value: string) {
  ensureExportConfig(table)
  ensureEntryPlacement(table)
  const n = parseInt(value, 10)
  table.exportConfig!.entryPlacement!.order = Number.isFinite(n) ? n : 10000
}

function ensureEntryPlacement(table: TableDef) {
  ensureExportConfig(table)
  if (!table.exportConfig!.entryPlacement) {
    table.exportConfig!.entryPlacement = { position: 'at_depth_as_system', depth: 2, order: 10000 }
  }
}

function ensureExportConfig(table: TableDef) {
  if (!table.exportConfig) {
    table.exportConfig = {
      enabled: true,
      entryType: 'constant',
      keywordColumn: '',
      keywordMode: 'custom'
    }
  }
}

function openKeywordPromptEditor(table: TableDef) {
  ensureExportConfig(table)
  keywordPromptEditing.value = table
  const raw = table.exportConfig!.keywordAiPrompt
  keywordPromptDraft.value = Array.isArray(raw) ? raw.map((s) => ({ ...s })) : []
  keywordPreviewMode.value = false
}

function saveKeywordPrompt() {
  if (keywordPromptEditing.value) {
    ensureExportConfig(keywordPromptEditing.value)
    keywordPromptEditing.value.exportConfig!.keywordAiPrompt = keywordPromptDraft.value.map((s) => ({ ...s }))
  }
  keywordPromptEditing.value = null
  keywordPromptDraft.value = []
  keywordPreviewMode.value = false
}

function closeKeywordPrompt() {
  keywordPromptEditing.value = null
  keywordPromptDraft.value = []
  keywordPreviewMode.value = false
}

function openKeywordPreview() {
  const tableName = keywordPromptEditing.value?.name ?? '表名'
  const segs = keywordPromptDraft.value.map((s) => ({ role: s.role, content: s.content }))
  const userMsg = {
    role: 'user',
    content: `表 ${tableName} 当前数据（N 行）：\n<行数据 JSON>\n\n请为每一行生成用于触发世界书注入的独特关键词。只输出 JSON 数组，每个元素是该行关键词数组，行数与输入行数一致，如：[["行1关键词1","行1关键词2"],["行2关键词1"]]`
  }
  keywordPreviewJson.value = JSON.stringify([...segs, userMsg], null, 2)
  keywordPreviewMode.value = true
}

function freshColumn(): ColumnDef {
  return { name: '', displayName: '', type: 'TEXT' }
}

const ttConfig = computed(() => store.config.tableTemplate)
const selectedPresetId = ref<string | null>(null)

const chatActive = computed(() => session.isChatActive())

const templateTick = ref(0)

const boundTemplate = computed<CardTemplate | null>(() => {
  void templateTick.value
  return session.getBoundTemplate()
})

function templateFingerprint(t: CardTemplate): string {
  const sorted = t.tables
    .filter((tb) => tb.enabled !== false)
    .map((tb) => ({
      name: tb.name,
      columns: tb.columns.map((c) => ({ name: c.name, type: c.type }))
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return JSON.stringify(sorted)
}

const boundMatchPresetId = computed<string | null>(() => {
  const bound = boundTemplate.value
  if (!bound) return null
  const boundId = session.getBoundTemplateId()
  if (boundId && ttConfig.value.presets.some((p) => p.id === boundId)) {
    return boundId
  }
  const currentId = session.getCurrentTemplateId()
  if (currentId && currentId !== '__bound__' && ttConfig.value.presets.some((p) => p.id === currentId)) {
    return currentId
  }
  const fp = templateFingerprint(bound)
  const matches = ttConfig.value.presets.filter((p) => templateFingerprint(p.template) === fp)
  return matches.length === 1 ? matches[0]!.id : null
})

const showBoundTempItem = computed(() => !!boundTemplate.value && !boundMatchPresetId.value)

const activeTemplatePreset = computed(
  () =>
    ttConfig.value.presets.find((p) => p.id === selectedPresetId.value) ??
    ttConfig.value.presets.find((p) => p.id === ttConfig.value.activeId) ??
    ttConfig.value.presets[0]
)

const editingTables = computed(() => activeTemplatePreset.value?.template?.tables ?? [])

const selectedTableIdx = ref(-1)
const keywordPromptEditing = ref<TableDef | null>(null)
const keywordPromptDraft = ref<PromptSegment[]>([])
const keywordPreviewMode = ref(false)
const keywordPreviewJson = ref('')
const keywordBlockRef = ref<{ addSegment: (role: PromptRole) => void; roles: PromptRole[]; roleLabels: Record<PromptRole, string> } | null>(null)

const selectedTable = computed(() => {
  const tables = editingTables.value
  if (selectedTableIdx.value < 0 || selectedTableIdx.value >= tables.length) return null
  return tables[selectedTableIdx.value]
})

const selectedView = ref<'preset' | 'chronicle'>('preset')

const chronicleDef = computed(
  () => store.config.chronicleTableDef ?? session.getChronicleTableDef()
)

function syncChronicleTableDef() {
  if (!store.config.chronicleTableDef) {
    store.config.chronicleTableDef = JSON.parse(JSON.stringify(session.getChronicleTableDef()))
  }
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

async function resetChronicleTableDef() {
  const def = session.getDefaultChronicleTable()
  if (!def) {
    toast.error('默认纪要表未加载，无法恢复')
    return
  }
  const ok = await confirm(
    '恢复默认纪要表',
    '恢复后将当前结构替换为默认纪要表结构并立即重建表：同名列数据迁移保留，删改列名的列数据丢失，此操作不可撤销。继续？',
    '恢复',
    true
  )
  if (!ok) return
  try {
    await session.applyChronicleTableDef(JSON.parse(JSON.stringify(def)))
    store.reload()
    toast.success('已恢复默认纪要表')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
  }
}

function selectChronicle() {
  selectedView.value = 'chronicle'
}

function handleNewPresetT(mode: 'blank' | 'default') {
  newPresetTVisible.value = false
  if (mode === 'blank') {
    const p = {
      id: newId('tpl'),
      name: `模板 ${ttConfig.value.presets.length + 1}`,
      template: { templateVersion: 1, tables: [] },
      source: 'user' as const
    }
    ttConfig.value.presets.push(p)
    selectedPresetId.value = p.id
    selectedTableIdx.value = -1
    store.save()
    toast.success('已新建模板预设，点击「设为当前」应用')
    return
  }
  const p = createUserTemplatePreset(session.getDefaultTemplate())
  if (!p) {
    toast.error('默认模板未加载，无法从默认创建')
    return
  }
  ttConfig.value.presets.push(p)
  selectedPresetId.value = p.id
  selectedTableIdx.value = -1
  store.save()
  toast.success('已从默认模板创建，点击「设为当前」应用')
}

function syncCardTemplate() {
  const CARD_PRESET_ID = '__card__'
  const existingIdx = ttConfig.value.presets.findIndex((p) => p.id === CARD_PRESET_ID)
  const fromCard = session.getCardTemplate()
  if (!fromCard || !Array.isArray(fromCard.tables) || fromCard.tables.length === 0) {
    if (existingIdx >= 0) {
      ttConfig.value.presets.splice(existingIdx, 1)
      if (ttConfig.value.activeId === CARD_PRESET_ID) {
        ttConfig.value.activeId = ttConfig.value.presets[0]?.id ?? ''
      }
      if (ttConfig.value.defaultId === CARD_PRESET_ID) {
        ttConfig.value.defaultId = ttConfig.value.presets[0]?.id ?? ''
      }
      store.save()
    }
    return
  }
  const cardPreset = {
    id: CARD_PRESET_ID,
    name: '当前角色卡',
    template: JSON.parse(JSON.stringify(fromCard)),
    source: 'card' as const
  }
  if (existingIdx === 0) {
    const top = ttConfig.value.presets[0]!
    if (JSON.stringify(top.template) === JSON.stringify(cardPreset.template)) return
    void confirm(
      '角色卡模板已变更',
      '角色卡内容已变化，是否同步到「当前角色卡」预设？你对它做过的手动编辑将被覆盖。',
      '同步',
      true
    ).then((ok) => {
      if (!ok) return
      ttConfig.value.presets.splice(0, 1, cardPreset)
      store.save()
      toast.success('已同步角色卡模板')
    })
    return
  }
  if (existingIdx > 0) {
    ttConfig.value.presets.splice(existingIdx, 1)
  }
  ttConfig.value.presets.unshift(cardPreset)
  if (!ttConfig.value.defaultId) {
    ttConfig.value.defaultId = CARD_PRESET_ID
  }
  store.save()
}

function selectPresetItem(id: string) {
  selectedView.value = 'preset'
  selectedPresetId.value = id
}

async function selectPresetT(id: string) {
  selectedView.value = 'preset'
  if (!session.isChatActive()) {
    toast.warning('未进入聊天，无法切换模板')
    return
  }
  const target = ttConfig.value.presets.find((p) => p.id === id)
  if (!target) return
  if (target.id === boundMatchPresetId.value) {
    toast.info('该模板已是当前聊天绑定的模板')
    return
  }

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
  const hasTableData = tables.some((t) => (session.getTableRowsWithRowid(t)[0]?.rows?.length ?? 0) > 0)
  if (hasTableData) {
    const ok = await confirm(
      '切换模板',
      `切换模板「${target.name}」将清空当前聊天的全部表格数据与历史快照帧（纪要数据保留），并把聊天绑定模板替换为新模板。此操作不可撤销。继续？`,
      '切换并清空',
      true
    )
    if (!ok) return
  }

  try {
    await session.reinitWithTemplate(target.template, target.id)
    templateTick.value++
    ttConfig.value.activeId = id
    selectedTableIdx.value = -1
    store.save()
    if (hasTableData) {
      toast.success('已切换到模板：' + target.name)
    }
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
  if (target.source === 'card') {
    toast.warning('角色卡模板不可删除')
    return
  }
  const ok = await confirm(
    '删除确认',
    `确认删除模板预设「${target.name}」？此操作不可撤销。`,
    '删除',
    true
  )
  if (!ok) return
  if (session.getBoundTemplateId() === id) {
    session.unbindBoundTemplate()
    toast.warning('该预设正在被当前聊天绑定使用，已一并解除绑定')
  }
  ttConfig.value.presets = ttConfig.value.presets.filter((p) => p.id !== id)
  if (ttConfig.value.activeId === id) ttConfig.value.activeId = ttConfig.value.presets[0]!.id
  if (ttConfig.value.defaultId === id) ttConfig.value.defaultId = ttConfig.value.presets[0]!.id
  if (selectedPresetId.value === id) selectedPresetId.value = null
  selectedTableIdx.value = -1
  store.save()
  toast.success('已删除')
}

function setDefaultPresetT(id: string) {
  ttConfig.value.defaultId = id
  store.save()
  toast.success('已设为默认')
}

async function renamePresetT(id: string) {
  const p = ttConfig.value.presets.find((p) => p.id === id)
  if (!p) return
  const name = await promptRename('重命名模板预设', '输入新的模板预设名称：', p.name)
  if (name == null) return
  if (!name.trim()) {
    toast.error('名称不能为空')
    return
  }
  p.name = name.trim()
  store.save()
  toast.success('已重命名')
}

async function renamePreset(id: string) {
  const p = sceneConfig.value.presets.find((p) => p.id === id)
  if (!p) return
  const name = await promptRename('重命名预设', '输入新的预设名称：', p.name)
  if (name == null) return
  if (!name.trim()) {
    toast.error('名称不能为空')
    return
  }
  p.name = name.trim()
  save()
  toast.success('已重命名')
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
  if (selectedTable.value.columns.length <= 1) {
    toast.warning('至少保留一个列')
    return
  }
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
      const notes: string[] = []

      if (isCardTemplate(raw)) {
        template = raw
      } else if (isShujukuTemplate(raw)) {
        template = convertShujukuToCardTemplate(raw)
        notes.push('检测到 shujuku 格式，已自动转换')
      } else {
        throw new Error('无法识别模板格式（需要 CardTemplate 或 shujuku TABLE_TEMPLATE）')
      }
      for (const t of template.tables) {
        if (t.name === CHRONICLE_TABLE_NAME && t.enabled !== false) t.enabled = false
      }
      const disabledCount = template.tables.filter((t) => t.enabled === false).length
      if (disabledCount > 0) {
        notes.push(`检测到 ${disabledCount} 张纪要表，已禁用，可在模板编辑器手动启用当普通表用`)
      }

      const preset = {
        id: newId('tpl'),
        name: file.name.replace(/\.json$/i, ''),
        template,
        source: 'user' as const
      }
      ttConfig.value.presets.push(preset)
      selectedTableIdx.value = -1
      store.save()
      toast.success(['已导入，点击「设为当前」应用', ...notes].join('\n'))
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
  templateTick.value++
  syncCardTemplate()
  syncChronicleTableDef()
})

function onDocClick(e: MouseEvent) {
  const target = e.target
  if (target instanceof Element && target.closest('.preset-list')) return
  selectedScenePresetId.value = null
  selectedPresetId.value = null
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="prompt-page">
    <div class="prompt-wrap cn-card">
      <div class="prompt-head">
        <CNTabs level="l1" :items="promptTabs" v-model="promptTabValue" />
        <CNTabs v-if="!showTemplate" level="l1" :items="scenes" v-model="sceneTabValue" />
      </div>

      <div v-if="showTemplate" class="prompt-split">
        <div class="prompt-side">
          <div class="cn-card__head">
            <span>模板预设</span>
            <button class="cn-btn cn-btn--sm" @click="newPresetTVisible = true">
              <i class="fa-solid fa-plus"></i>
              新建
            </button>
          </div>
          <div class="cn-card__body">
            <ul class="preset-list">
              <li
                v-if="showBoundTempItem"
                class="preset-list__item preset-list__item--bound"
              >
                <span class="preset-list__name">
                  <i class="fa-solid fa-link preset-list__card" title="本聊天绑定模板"></i>
                  <span class="preset-list__name-text">本聊天绑定模板</span>
                </span>
                <span class="preset-list__badge">使用中</span>
                <span class="preset-list__count">{{ boundTemplate?.tables.length ?? 0 }}表</span>
              </li>
              <li
                v-for="p in ttConfig.presets"
                :key="p.id"
                class="preset-list__item"
                :class="{
                  'preset-list__item--active':
                    p.id === ttConfig.activeId && selectedView === 'preset',
                  'preset-list__item--selected':
                    selectedPresetId === p.id && p.id !== ttConfig.activeId,
                  'preset-list__item--bound': p.id === boundMatchPresetId
                }"
                @click="selectPresetItem(p.id)"
              >
                <span class="preset-list__name">
                  <i
                    v-if="p.source === 'card'"
                    class="fa-solid fa-id-card preset-list__card"
                    title="角色卡自带模板"
                  ></i>
                  <span class="preset-list__name-text">{{ p.name }}</span>
                  <i
                    v-if="p.id === ttConfig.defaultId"
                    class="fa-solid fa-star preset-list__default"
                    title="默认预设"
                  ></i>
                </span>
                <span class="preset-list__count">{{ p.template.tables.length }}表</span>
                <span v-if="p.id === boundMatchPresetId" class="preset-list__badge">使用中</span>
                <button
                  v-if="selectedPresetId === p.id && p.id !== boundMatchPresetId && chatActive"
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="设为当前"
                  @click.stop="selectPresetT(p.id)"
                >
                  <i class="fa-solid fa-check"></i>
                </button>
                <button
                  v-if="selectedPresetId === p.id && p.id !== ttConfig.defaultId"
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="设为默认"
                  @click.stop="setDefaultPresetT(p.id)"
                >
                  <i class="fa-solid fa-star"></i>
                </button>
                <button
                  v-if="selectedPresetId === p.id && p.source !== 'card'"
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="删除"
                  @click.stop="deletePresetT(p.id)"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </li>
            </ul>
          </div>
          <div class="prompt-side__chronicle">
            <div
              class="preset-list__item preset-list__item--chronicle"
              :class="{ 'preset-list__item--active': selectedView === 'chronicle' }"
              @click="selectChronicle"
            >
              <span class="preset-list__name">
                <i class="fa-solid fa-clock-rotate-left preset-list__card"></i>
                <span class="preset-list__name-text">纪要表</span>
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

        <div class="prompt-editor" v-if="selectedView === 'chronicle'">
          <div class="cn-card__head">
            <span>纪要表（系统内置）</span>
            <span class="prompt-editor__desc"
              >结构可编辑；保存后按新结构重建表（同名列数据迁移）。表名固定不可改。</span
            >
            <button class="cn-btn cn-btn--sm" @click="resetChronicleTableDef">
              <i class="fa-solid fa-rotate-left"></i>
              恢复默认
            </button>
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
                    <div class="cn-input cn-input--locked">{{ chronicleDef.name }}</div>
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
                  </div>
                  <div class="tpl-cols">
                    <div class="tpl-col-head">
                      <span class="tpl-col-cell name">英文名</span>
                      <span class="tpl-col-cell name">中文名</span>
                      <span class="tpl-col-cell type">类型</span>
                      <span class="tpl-col-cell flags">约束</span>
                      <span class="tpl-col-cell note">AI 提示</span>
                    </div>
                    <div v-for="(col, ci) in chronicleDef.columns" :key="ci" class="tpl-col-row">
                      <div class="cn-input cn-input--locked tpl-col-cell name">{{ col.name }}</div>
                      <input
                        class="cn-input tpl-col-cell name"
                        v-model="col.displayName"
                        placeholder="中文名"
                      />
                      <select class="cn-select tpl-col-cell type" v-model="col.type" disabled>
                        <option v-for="t in COL_TYPES" :key="t" :value="t">{{ t }}</option>
                      </select>
                      <span class="tpl-col-cell flags">
                        <button
                          class="cn-btn cn-btn--xs"
                          :class="{ 'cn-btn--primary': col.constraints?.primaryKey }"
                          title="主键"
                          disabled
                        >
                          PK
                        </button>
                        <button
                          class="cn-btn cn-btn--xs"
                          :class="{ 'cn-btn--primary': col.constraints?.unique }"
                          title="唯一"
                          disabled
                        >
                          UQ
                        </button>
                        <button
                          class="cn-btn cn-btn--xs"
                          :class="{ 'cn-btn--primary': !col.constraints?.nullable }"
                          title="非空"
                          disabled
                        >
                          NN
                        </button>
                      </span>
                      <input
                        class="cn-input tpl-col-cell note"
                        v-model="col.note"
                        placeholder="列说明（注入 AI prompt）"
                      />
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
            <span class="prompt-editor__title-group">
              <span class="prompt-editor__title">{{ activeTemplatePreset.name }}</span>
              <button
                class="cn-btn cn-btn--sm cn-btn--text"
                title="重命名"
                @click="renamePresetT(activeTemplatePreset.id)"
              >
                <i class="fa-solid fa-pen"></i>
              </button>
            </span>
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
              :class="{ 'tpl-table-card--active': ti === selectedTableIdx, 'tpl-table-card--disabled': table.enabled === false }"
            >
              <div
                class="tpl-table-card__head"
                @click="selectedTableIdx = selectedTableIdx === ti ? -1 : ti"
              >
                <span class="tpl-table-card__name">{{
                  table.displayName || table.name || '(未命名)'
                }}</span>
                <span v-if="table.enabled === false" class="tpl-table-card__badge">已禁用</span>
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
                  <div class="tpl-row" style="align-items: center; flex-wrap: wrap; row-gap: 8px">
                    <div class="tpl-field" style="flex: 0 0 auto">
                      <label class="tpl-label" style="font-size: 12px">启用此表</label>
                      <label class="cn-switch" style="height: 32px; display: inline-flex; align-items: center">
                        <input
                          type="checkbox"
                          :checked="table.enabled !== false"
                          @change="table.enabled = ($event.target as HTMLInputElement).checked ? undefined : false"
                        />
                        <span class="cn-switch__track"></span>
                      </label>
                    </div>
                    <span v-if="table.enabled === false" style="font-size: 12px; color: var(--cn-text-3)">禁用的表不会建表、不参与填表</span>
                  </div>
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
                    <div class="tpl-row tpl-row--inject" style="flex-wrap: wrap; row-gap: 8px; align-items: flex-start">
                      <div class="tpl-field" style="flex: 0 0 auto">
                        <label class="tpl-label" style="font-size: 12px">启用注入</label>
                        <label class="cn-switch" style="height: 32px; display: inline-flex; align-items: center">
                          <input
                            type="checkbox"
                            :checked="table.exportConfig?.enabled !== false"
                            @change="setExportEnabled(table, ($event.target as HTMLInputElement).checked)"
                          />
                          <span class="cn-switch__track"></span>
                        </label>
                      </div>
                      <div class="tpl-field" style="flex: 0 0 180px">
                        <label class="tpl-label" style="font-size: 12px">注入类型</label>
                        <select
                          class="cn-select"
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
                      <div
                        class="tpl-field"
                        :class="{ 'tpl-field--hidden': table.exportConfig?.entryType !== 'keyword' }"
                        style="flex: 0 0 180px"
                      >
                        <label class="tpl-label" style="font-size: 12px">关键词来源</label>
                        <select
                          class="cn-select"
                          @change="setExportKeywordMode(table, ($event.target as HTMLSelectElement).value)"
                        >
                          <option
                            value="custom"
                            :selected="(table.exportConfig?.keywordMode ?? 'custom') === 'custom'"
                          >
                            选列（按列值激活）
                          </option>
                          <option
                            value="ai_prompt"
                            :selected="table.exportConfig?.keywordMode === 'ai_prompt'"
                          >
                            AI 生成
                          </option>
                        </select>
                      </div>
                      <div
                        class="tpl-field"
                        :class="{ 'tpl-field--hidden': !(table.exportConfig?.entryType === 'keyword' && (table.exportConfig?.keywordMode ?? 'custom') === 'custom') }"
                        style="flex: 0 0 180px"
                      >
                        <label class="tpl-label" style="font-size: 12px">关键词列</label>
                        <select
                          class="cn-select"
                          @change="setExportKeywordColumn(table, ($event.target as HTMLSelectElement).value)"
                        >
                          <option
                            value=""
                            :selected="!table.exportConfig?.keywordColumn"
                          >
                            -- 选择列 --
                          </option>
                          <option
                            v-for="c in table.columns"
                            :key="c.name"
                            :value="c.name"
                            :selected="table.exportConfig?.keywordColumn === c.name"
                          >
                            {{ c.displayName || c.name }}
                          </option>
                        </select>
                      </div>
                      <div
                        class="tpl-field"
                        :class="{ 'tpl-field--hidden': !(table.exportConfig?.entryType === 'keyword' && table.exportConfig?.keywordMode === 'ai_prompt') }"
                        style="flex: 0 0 auto"
                      >
                        <label class="tpl-label" style="font-size: 12px; visibility: hidden">占</label>
                        <button class="cn-btn" @click="openKeywordPromptEditor(table)">
                          <i class="fa-solid fa-pen"></i>
                          编辑提示词
                        </button>
                      </div>
                      <div class="tpl-field" style="flex: 0 0 180px">
                        <label class="tpl-label" style="font-size: 12px">注入位置</label>
                        <select
                          class="cn-select"
                          @change="setExportPlacementPosition(table, ($event.target as HTMLSelectElement).value)"
                        >
                          <option
                            value="at_depth_as_system"
                            :selected="(table.exportConfig?.entryPlacement?.position ?? 'at_depth_as_system') === 'at_depth_as_system'"
                          >
                            系统深度 @D
                          </option>
                          <option
                            value="at_depth_as_user"
                            :selected="table.exportConfig?.entryPlacement?.position === 'at_depth_as_user'"
                          >
                            用户深度 @D
                          </option>
                          <option
                            value="at_depth_as_assistant"
                            :selected="table.exportConfig?.entryPlacement?.position === 'at_depth_as_assistant'"
                          >
                            Assistant深度 @D
                          </option>
                          <option
                            value="before_character_definition"
                            :selected="table.exportConfig?.entryPlacement?.position === 'before_character_definition'"
                          >
                            角色定义前
                          </option>
                          <option
                            value="after_character_definition"
                            :selected="table.exportConfig?.entryPlacement?.position === 'after_character_definition'"
                          >
                            角色定义后
                          </option>
                        </select>
                      </div>
                      <div
                        class="tpl-field"
                        :class="{ 'tpl-field--hidden': !isAtDepthPosition(table.exportConfig?.entryPlacement?.position) }"
                        style="flex: 0 0 88px"
                      >
                        <label class="tpl-label" style="font-size: 12px">深度</label>
                        <input
                          type="number"
                          class="cn-input cn-input--nospin"
                          :value="table.exportConfig?.entryPlacement?.depth ?? 2"
                          @input="setExportPlacementDepth(table, ($event.target as HTMLInputElement).value)"
                        />
                      </div>
                      <div class="tpl-field" style="flex: 0 0 88px">
                        <label class="tpl-label" style="font-size: 12px">顺序</label>
                        <input
                          type="number"
                          class="cn-input cn-input--nospin"
                          :value="table.exportConfig?.entryPlacement?.order ?? 10000"
                          @input="setExportPlacementOrder(table, ($event.target as HTMLInputElement).value)"
                        />
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

      <template v-if="!showTemplate">
        <div class="prompt-split">
          <div class="prompt-side">
            <div class="cn-card__head">
              <span>预设</span>
              <button class="cn-btn cn-btn--sm" @click="newPresetVisible = true">
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
                  :class="{
                    'preset-list__item--active': p.id === sceneConfig.activeId,
                    'preset-list__item--selected':
                      selectedScenePresetId === p.id && p.id !== sceneConfig.activeId
                  }"
                  @click="selectedScenePresetId = p.id"
                >
                  <span class="preset-list__name">
                    <span class="preset-list__name-text">{{ p.name }}</span>
                    <i
                      v-if="p.id === sceneConfig.defaultId"
                      class="fa-solid fa-star preset-list__default"
                      title="默认预设"
                    ></i>
                  </span>
                  <span class="preset-list__count">{{ p.segments.length }}段</span>
                  <button
                    v-if="selectedScenePresetId === p.id && p.id !== sceneConfig.activeId"
                    class="cn-btn cn-btn--sm cn-btn--text"
                    title="设为当前"
                    @click.stop="selectPreset(p.id)"
                  >
                    <i class="fa-solid fa-check"></i>
                  </button>
                  <button
                    v-if="selectedScenePresetId === p.id && p.id !== sceneConfig.defaultId"
                    class="cn-btn cn-btn--sm cn-btn--text"
                    title="设为默认"
                    @click.stop="setDefaultPreset(p.id)"
                  >
                    <i class="fa-solid fa-star"></i>
                  </button>
                  <button
                    v-if="selectedScenePresetId === p.id"
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
              <span v-if="activePreset" class="prompt-editor__title-group">
                <span class="prompt-editor__title">{{ activePreset.name }}</span>
                <button
                  class="cn-btn cn-btn--sm cn-btn--text"
                  title="重命名"
                  @click="renamePreset(activePreset.id)"
                >
                  <i class="fa-solid fa-pen"></i>
                </button>
              </span>
              <button class="cn-btn cn-btn--soft cn-btn--sm" @click="varHelpVisible = true">
                <i class="fa-solid fa-tags"></i>
                可用变量
              </button>
            </div>
            <div class="cn-card__body">
              <PromptBlockEditor
                v-if="activePreset"
                v-model="activePreset.segments"
                :min-segments="1"
              />
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
          <input type="file" accept=".json" hidden @change="importTemplate" />
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

    <Transition name="cn-modal">
      <div v-if="keywordPromptEditing" class="cn-modal-mask" @click.self="closeKeywordPrompt">
        <div class="cn-modal">
          <div class="cn-modal__head">
            <span class="cn-modal__title">编辑关键词生成提示词</span>
            <button class="cn-btn cn-btn--sm cn-btn--text" @click="closeKeywordPrompt">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="cn-modal__body">
            <p v-if="!keywordPreviewMode" style="font-size: 12px; color: var(--cn-text-3); margin-bottom: 8px">
              此提示词在表格更新时发送给 AI，为每行生成用于触发世界书注入的独特关键词。多段按顺序拼接，模拟多轮对话。
            </p>
            <div v-if="!keywordPreviewMode" class="keyword-editor-pane">
              <PromptBlockEditor ref="keywordBlockRef" v-model="keywordPromptDraft" :show-add-row="false" />
            </div>
            <div v-if="!keywordPreviewMode" class="seg-add-row" style="margin-top: 8px">
              <button
                v-for="r in keywordBlockRef?.roles ?? []"
                :key="r"
                class="cn-btn cn-btn--sm"
                @click="keywordBlockRef?.addSegment(r)"
              >
                <i class="fa-solid fa-plus"></i>
                {{ keywordBlockRef?.roleLabels[r] ?? r }}
              </button>
            </div>
            <pre v-else class="cn-modal__code">{{ keywordPreviewJson }}</pre>
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px">
            <button v-if="!keywordPreviewMode" class="cn-btn cn-btn--sm" @click="openKeywordPreview">
              <i class="fa-solid fa-eye"></i>
              预览
            </button>
            <button v-else class="cn-btn cn-btn--sm" @click="keywordPreviewMode = false">
              <i class="fa-solid fa-pen"></i>
              返回编辑
            </button>
            <button class="cn-btn cn-btn--sm" @click="closeKeywordPrompt">取消</button>
            <button class="cn-btn cn-btn--sm cn-btn--primary" @click="saveKeywordPrompt">保存</button>
          </div>
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
            <input type="file" accept=".json" hidden @change="importPreset" />
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

      <VariableHelpModal v-model:visible="varHelpVisible" :scene="activeScene" />
    </template>

    <PresetSourceModal
      v-model:visible="newPresetVisible"
      title="新建预设"
      default-label="从默认提示词创建"
      :default-desc="`以默认「${PROMPT_VARIABLES[activeScene].label}」提示词为起点`"
      :default-disabled="!defaultPromptAvailable"
      default-disabled-hint="默认提示词加载失败，暂不可用"
      @pick="handleNewPreset"
    />

    <PresetSourceModal
      v-model:visible="newPresetTVisible"
      title="新建模板预设"
      default-label="从默认模板创建"
      default-desc="以扩展自带的默认表格模板为起点（含全部默认表）"
      :default-disabled="!defaultTemplateAvailable"
      default-disabled-hint="默认模板加载失败，暂不可用"
      @pick="handleNewPresetT"
    />
  </div>
</template>
