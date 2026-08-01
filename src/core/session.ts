import SqliteCore from '@db/sqlite/core'
import { loadDefaultPrompts } from '@db/gateways/prompt'
import {
  createAiGateway,
  createCharacterGateway,
  createChatGateway,
  createConfigGateway,
  createEventGateway,
  createVectorGateway,
  createWorldbookGateway,
  getHostContext
} from '@db/gateways'
import type {
  AiGateway,
  AiChatMessage,
  ChatGateway,
  CharacterGateway,
  EventGateway,
  VectorGateway,
  WorldbookGateway
} from '@db/gateways'
import type { ConfigGateway } from '@db/gateways/config'
import SqliteSyncBridge from '@db/sqlite/sync-bridge'
import NameMapper from '@shared/namemapper'
import { buildCreateTableSql, quoteIdent } from '@shared/template-builder'
import { DEFAULT_CHRONICLE_TABLE, CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import { validateTimeRegistration, clearTimeRegistration } from './time'
import { EVENT_CHAT_CHANGED } from '@shared/constants/events'
import type { CardTemplate } from '@shared/types/card'
import type { ChronicleColumnRole, QueryResult, TableDef } from '@shared/types/table'
import type {
  CranialNerveConfig,
  AiPreset,
  ScenePreset,
  PromptSegment,
  PromptSceneKey,
  ProgressStarter,
  ToastNotifier,
  TableTemplatePreset
} from '@shared/types/config'
import { TableEditor } from './table'
import ChronicleEntryStore from './worldbook-entries'
import type { ChronicleEntry } from '@shared/types/worldbook'
import createChronicleRecaller, { type ChronicleRecaller } from './chronicle'
import createWriteQueue, { type WriteQueue } from './write-queue'
import { buildBookName, cleanupStaleBooks, syncToWorldbook } from './worldbook-sync'
import { resetFillScheduler, onGenerationEnded, isFillInProgress, markGenerationStopped, resetGenerationStopped, buildWorldbookContext } from './table/fill-orchestrator'
import { onPromptReady } from './chronicle/recall-orchestrator'
import { getPersonaDescription, getCharDescription, getUserName } from '@db/gateways/host-state'
import { exportCheckpoint, validateCheckpointFile } from './checkpoint-transfer'
import { pushLog } from '@shared/log-buffer'
import { EVENT_GENERATION_ENDED, EVENT_GENERATION_AFTER_COMMANDS, EVENT_CHAT_RENAMED, EVENT_GENERATION_STARTED, EVENT_GENERATION_STOPPED, EVENT_MESSAGE_DELETED, EVENT_MESSAGE_SENT } from '@shared/constants/events'

export class CranialNerveSession {
  readonly core: SqliteCore
  readonly character: CharacterGateway
  readonly chat: ChatGateway
  readonly ai: AiGateway
  readonly config: ConfigGateway
  readonly event: EventGateway
  readonly worldbook: WorldbookGateway
  readonly vector: VectorGateway
  private syncBridge: SqliteSyncBridge | null = null
  private tableEditor: TableEditor | null = null
  private nameMapper: NameMapper | null = null
  private template: CardTemplate | null = null
  private currentTemplateId: string | null = null
  private chronicleStore: ChronicleEntryStore | null = null
  private chronicleRecaller: ChronicleRecaller | null = null
  private writeQueue: WriteQueue
  private progressNotifier?: ProgressStarter
  private toastNotifier?: ToastNotifier
  private recallCardRenderer?: (msgId: number) => void
  private currentChatToken: string | null = null
  private autoSwitchHandler: ((...args: unknown[]) => unknown) | null = null
  private reloadSeq = 0
  private lastSnapshotIndex: number | null = null
  private initFailed = false
  private lastRecalledUserSendDate: string | null = null
  private realGenerationPending = false

  constructor() {
    this.core = new SqliteCore()
    this.character = createCharacterGateway()
    this.chat = createChatGateway()
    this.ai = createAiGateway()
    this.config = createConfigGateway()
    this.event = createEventGateway()
    this.worldbook = createWorldbookGateway()
    this.vector = createVectorGateway()
    this.writeQueue = createWriteQueue()
  }

  async init(): Promise<void> {
    try {
      await loadDefaultPrompts()
      await this.core.init()
      this.syncBridge = new SqliteSyncBridge(this.core, this.chat)
      this.tableEditor = new TableEditor(this.core, this.ai)
      this.startAutoSwitch()
      this.bindCoreEvents()
      await this.reloadForChatChange()
      this.initFailed = false
    } catch (e) {
      this.initFailed = true
      pushLog('error', 'session', `初始化失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  isInitialized(): boolean {
    return !this.initFailed && this.syncBridge !== null && this.tableEditor !== null
  }

  private eventsBound = false
  private bindCoreEvents(): void {
    if (this.eventsBound) return
    this.eventsBound = true
    this.event.makeLast(EVENT_GENERATION_ENDED, () => {
      pushLog('info', 'session', `GENERATION_ENDED 触发，realGenerationPending=${this.realGenerationPending}`)
      if (!this.realGenerationPending) {
        return
      }
      this.realGenerationPending = false
      onGenerationEnded(this).catch((e) => {
        pushLog('error', 'session', `onGenerationEnded error: ${e instanceof Error ? e.message : String(e)}`)
      })
    })
    this.event.makeLast(EVENT_GENERATION_AFTER_COMMANDS, (...args: unknown[]) => {
      const type = args[0] as string | undefined
      const dryRun = args[2] as boolean | undefined
      if (dryRun) {
        return
      }
      this.realGenerationPending = true
      const isRegenerate = type === 'regenerate' || type === 'swipe'
      if (isRegenerate) {
        pushLog('info', 'session', 'regenerate/swipe：回退数据、不召回，生成后填表')
        return this.reloadForChatChange().then(() => {
          this.realGenerationPending = true
        }).catch((e) => {
          pushLog('error', 'session', `regenerate 回退失败: ${e instanceof Error ? e.message : String(e)}`)
        })
      }
      return undefined
    })
    this.event.makeLast(EVENT_MESSAGE_SENT, (...args: unknown[]) => {
      const msgId = args[0]
      if (typeof msgId !== 'number') {
        return
      }
      if (isFillInProgress()) {
        pushLog('warn', 'session', '纪要生成中，跳过本轮召回')
        return
      }
      const chat = this.chat.getChat()
      const msg = chat[msgId]
      if (!msg || !msg.is_user) {
        return
      }
      const sendDate = msg.send_date
      pushLog('info', 'session', `MESSAGE_SENT msgId=${msgId} sendDate=${sendDate} lastRecalled=${this.lastRecalledUserSendDate}`)
      if (sendDate && sendDate === this.lastRecalledUserSendDate) {
        pushLog('info', 'session', '玩家消息未变，跳过召回')
        return
      }
      this.lastRecalledUserSendDate = sendDate ?? null
      return onPromptReady(this, msgId).then((recalled) => {
        if (!recalled) {
          this.lastRecalledUserSendDate = null
          this.realGenerationPending = false
        }
      }).catch((e) => {
        pushLog('error', 'session', `onPromptReady error: ${e instanceof Error ? e.message : String(e)}`)
      })
    })
    this.event.on(EVENT_GENERATION_STARTED, () => resetGenerationStopped())
    this.event.on(EVENT_GENERATION_STOPPED, () => markGenerationStopped())
    this.event.on(EVENT_CHAT_RENAMED, (...args: unknown[]) => {
      const payload = args[0] as { oldFileName?: string; newFileName?: string } | undefined
      if (payload?.oldFileName && payload?.newFileName) {
        this.renameWorldbook(payload.oldFileName, payload.newFileName).catch((e) => {
          pushLog('error', 'session', `世界书重命名失败: ${e instanceof Error ? e.message : String(e)}`)
        })
      }
    })
    this.event.on(EVENT_MESSAGE_DELETED, () => {
      pushLog('info', 'session', '消息删除，重建内存库以回退数据')
      this.reloadForChatChange().catch((e) => {
        pushLog('error', 'session', `删除消息后重建失败: ${e instanceof Error ? e.message : String(e)}`)
      })
    })
  }

  private setupChronicle(): void {
    const name = buildBookName(this.getChatToken())
    this.chronicleStore = new ChronicleEntryStore(this.worldbook, name)
    const tableReader = async (): Promise<ChronicleEntry[]> => this.getChronicleEntries()
    this.chronicleRecaller = createChronicleRecaller(this.ai, tableReader, this.vector)
  }

  getChronicleEntries(): ChronicleEntry[] {
    const def = this.getChronicleTableDef()
    const colName = (role: ChronicleColumnRole) =>
      def.columns.find((c) => c.role === role)?.name
    const kKey = colName('key')
    const kTimeStart = colName('timeStart')
    const kTimeEnd = colName('timeEnd')
    const kLocation = colName('location')
    const kSummary = colName('summary')
    const kKeyDialogue = colName('keyDialogue')
    let result: QueryResult[]
    try {
      result = this.core.exec(`SELECT * FROM "${CHRONICLE_TABLE_NAME}"`)
    } catch (e) {
      pushLog('warn', 'session', `纪要表读取失败: ${e instanceof Error ? e.message : String(e)}`)
      return []
    }
    const first = result[0]
    if (!first) return []
    const pick = (r: Record<string, unknown>, name?: string): string =>
      name ? String(r[name] ?? '') : ''
    return first.rows.map((r) => ({
      key: pick(r, kKey),
      timeStart: pick(r, kTimeStart),
      timeEnd: pick(r, kTimeEnd),
      content: {
        summary: pick(r, kSummary),
        storyTime: pick(r, kTimeStart),
        keyDialogue: pick(r, kKeyDialogue),
        location: pick(r, kLocation)
      }
    }))
  }

  renderRecallCard(msgId: number): void {
    pushLog('info', 'session', `renderRecallCard msgId=${msgId} renderer=${!!this.recallCardRenderer}`)
    if (!this.recallCardRenderer) return
    try {
      this.recallCardRenderer(msgId)
    } catch (e) {
      pushLog('warn', 'session', `召回卡片渲染失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async getWorldbookPreview(scanText: string): Promise<string> {
    try {
      return await buildWorldbookContext(this, scanText)
    } catch (e) {
      pushLog('warn', 'session', `世界书预览失败: ${e instanceof Error ? e.message : String(e)}`)
      return ''
    }
  }

  getConversationText(depth = 10): string {
    const chat = this.chat.getChat()
    const userName = getUserName()
    const recent = chat.slice(-depth)
    return recent.map((m) => `${m.is_user ? userName : 'Assistant'}: ${m.mes}`).join('\n')
  }

  getPersonaDescription(): string {
    return getPersonaDescription()
  }

  getCharDescription(): string {
    return getCharDescription()
  }

  getLastUserMessage(): string {
    const chat = this.chat.getChat()
    const idx = this.getLastUserIdx()
    if (idx < 0) return ''
    return chat[idx]?.mes ?? ''
  }

  async generateKeywordsForTable(tableName: string, aiPrompt: string): Promise<string[]> {
    const cfg = this.getConfig()
    const preset = this.getAiPresetForScene(cfg.tableFillPresetId)
    if (!preset) {
      throw new Error('未配置 AI 预设，请先在 API 配置中设置')
    }
    const tableData = this.getTableData(tableName)
    const rows = tableData[0]?.rows ?? []
    const messages: AiChatMessage[] = [
      { role: 'system', content: aiPrompt },
      { role: 'user', content: `表 ${tableName} 当前数据（${rows.length} 行）：\n${JSON.stringify(rows)}\n\n请根据以上表格内容生成用于触发世界书注入的关键词。只输出关键词，用逗号分隔。` }
    ]
    const raw = await this.ai.chatCompletion(
      messages,
      { baseURL: preset.baseURL, apiKey: preset.apiKey, customIncludeBody: preset.customIncludeBody, customExcludeBody: preset.customExcludeBody, customIncludeHeaders: preset.customIncludeHeaders },
      { model: preset.model, max_tokens: preset.maxTokens, temperature: preset.temperature, top_p: preset.topP, frequency_penalty: preset.frequencyPenalty, presence_penalty: preset.presencePenalty, seed: preset.seed >= 0 ? preset.seed : undefined, stream: preset.stream },
      undefined,
      { timeoutMs: cfg.pending.aiCallTimeoutMs, timeoutRetries: cfg.pending.aiTimeoutRetries }
    )
    return raw.split(/[,，\n]/).map((k) => k.trim()).filter(Boolean)
  }

  startAutoSwitch(): void {
    if (this.autoSwitchHandler) {
      return
    }
    const handler = async () => {
      try {
        await this.reloadForChatChange()
      } catch (e) {
        pushLog('error', 'session', `reloadForChatChange 失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    this.autoSwitchHandler = handler
    this.event.on(EVENT_CHAT_CHANGED, handler)
  }

  stopAutoSwitch(): void {
    if (this.autoSwitchHandler) {
      this.event.off(EVENT_CHAT_CHANGED, this.autoSwitchHandler)
      this.autoSwitchHandler = null
    }
  }

  async reloadForChatChange(): Promise<void> {
    const mySeq = ++this.reloadSeq
    const prevToken = this.currentChatToken
    this.lastRecalledUserSendDate = null
    this.realGenerationPending = false
    try {
      await this.writeQueue.waitForDrain(this.getConfig().pending.writeQueueDrainTimeoutMs)
    } catch (e) {
      pushLog('error', 'session', `等待写入队列超时，强制继续 reload: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (mySeq !== this.reloadSeq) {
      return
    }
    if (prevToken) {
      clearTimeRegistration(prevToken)
    }
    this.currentChatToken = null
    this.core.dispose()
    try {
      await this.core.init()
    } catch (e) {
      pushLog('error', 'session', `core.init 失败: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    if (mySeq !== this.reloadSeq) {
      return
    }
    this.nameMapper = null
    this.template = null
    resetFillScheduler()
    this.setupChronicle()
    try {
      this.initSessionTemplate()
    } catch (e) {
      pushLog('warn', 'session', `模板加载异常: ${e instanceof Error ? e.message : String(e)}`)
      if (this.hasValidChatToken()) {
        this.toastNotifier?.warning('模板加载异常，已降级使用默认表结构')
      }
    }
    if (mySeq !== this.reloadSeq) {
      return
    }
    this.core.run(buildCreateTableSql(this.getChronicleTableDef()))
    this.loadFromChat()
    if (mySeq !== this.reloadSeq) {
      return
    }
    await this.setupWorldbook(mySeq)
  }

  getChatToken(): string {
    if (this.currentChatToken) {
      return this.currentChatToken
    }
    try {
      const ctx = getHostContext()
      const chatId = ctx.chatId ?? ctx.getCurrentChatId?.()
      if (chatId && typeof chatId === 'string') {
        this.currentChatToken = chatId
        return chatId
      }
    } catch {}
    this.currentChatToken = `cn_${Date.now().toString(36)}`
    return this.currentChatToken
  }

  isChatActive(): boolean {
    try {
      const ctx = getHostContext()
      const chatId = ctx.chatId ?? ctx.getCurrentChatId?.()
      return !!(chatId && typeof chatId === 'string')
    } catch {
      return false
    }
  }

  hasValidChatToken(): boolean {
    try {
      const ctx = getHostContext()
      const chatId = ctx.chatId ?? ctx.getCurrentChatId?.()
      return !!chatId && typeof chatId === 'string'
    } catch {
      return false
    }
  }

  private async setupWorldbook(mySeq: number): Promise<void> {
    if (mySeq !== this.reloadSeq) {
      return
    }
    try {
      await cleanupStaleBooks(this)
      if (mySeq !== this.reloadSeq) {
        return
      }
      if (!this.hasValidChatToken()) {
        pushLog('info', 'session', '无有效 chatId，跳过世界书同步（仅清理残留）')
        return
      }
      await syncToWorldbook(this)
    } catch (e) {
      pushLog('error', 'session', `世界书初始化失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private async renameWorldbook(oldToken: string, newToken: string): Promise<void> {
    if (oldToken === newToken) return
    const wb = this.worldbook
    const oldName = buildBookName(oldToken)
    const newName = buildBookName(newToken)
    const all = wb.listWorldbookNames()
    if (!all.includes(oldName)) return
    try {
      const data = await wb.loadLorebook(oldName)
      await wb.saveLorebook(newName, data)
      await wb.deleteWorldbook(oldName)
      this.currentChatToken = newToken
      await wb.attachToChat(newName)
      pushLog('warn', 'session', `世界书重命名: ${oldName} -> ${newName}`)
    } catch (e) {
      pushLog('error', 'session', `世界书重命名失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  initGameSession(template: CardTemplate, id?: string): void {
    validateTimeRegistration(this.getChatToken())
    this.template = template
    this.currentTemplateId = id ?? null
    this.nameMapper = new NameMapper(template.tables)
    for (const table of template.tables) {
      if (!table.name || table.columns.length === 0) continue
      this.core.run(buildCreateTableSql(table))
    }
    this.core.run(buildCreateTableSql(this.getChronicleTableDef()))
  }

  initGameSessionFromCard(): CardTemplate | null {
    const template = this.character.readTemplateFromCard()
    if (template) {
      this.initGameSession(template, '__card__')
    }
    return template
  }

  async reinitWithTemplate(template: CardTemplate, id?: string): Promise<void> {
    this.template = template
    this.currentTemplateId = id ?? null
    this.nameMapper = new NameMapper(template.tables)
    this.core.dispose()
    await this.core.init()
    for (const table of template.tables) {
      if (!table.name || table.columns.length === 0) continue
      this.core.run(buildCreateTableSql(table))
    }
    this.core.run(buildCreateTableSql(this.getChronicleTableDef()))
    const chat = this.chat.getChat()
    const targetId = chat.length - 1
    if (this.syncBridge && targetId >= 0) {
      this.syncBridge.removeAllSnapshots()
      this.syncBridge.writeCheckpoint(targetId, 'manual', this.currentTemplateId ?? undefined)
    }
    try {
      await syncToWorldbook(this)
    } catch (e) {
      pushLog('error', 'session', `reinitWithTemplate 同步世界书失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  private initSessionTemplate(): void {
    const templateId = this.readFrameTemplateId()
    if (templateId && templateId !== '__card__') {
      const cfg = this.getConfig()
      const preset = cfg.tableTemplate.presets.find((p) => p.id === templateId)
      if (preset) {
        try {
          this.initGameSession(preset.template, preset.id)
          return
        } catch (e) {
          pushLog('warn', 'session', `聊天模板加载失败，降级: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
    let cardTemplate: CardTemplate | null = null
    let cardError = false
    try {
      cardTemplate = this.character.readTemplateFromCard()
    } catch (e) {
      cardError = true
      pushLog('warn', 'session', `角色卡模板异常: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (cardTemplate) {
      try {
        this.initGameSession(cardTemplate, '__card__')
        this.toastNotifier?.success('已加载角色卡内置模板')
        return
      } catch (e) {
        cardError = true
        pushLog('warn', 'session', `角色卡模板建表失败，降级: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (cardError) {
      this.toastNotifier?.warning('角色卡内置模板存在错误，已降级使用默认模板')
    }
    const fallback = this.resolveDefaultTemplatePreset()
    if (fallback) {
      try {
        this.initGameSession(fallback.template, fallback.id)
      } catch (e) {
        pushLog('error', 'session', `默认模板建表失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  private resolveDefaultTemplatePreset(): TableTemplatePreset | null {
    const tableTemplate = this.getConfig().tableTemplate
    const byId = (id: string) => tableTemplate.presets.find((p) => p.id === id)
    return byId(tableTemplate.activeId) ?? byId(tableTemplate.defaultId) ?? tableTemplate.presets[0] ?? null
  }

  private readFrameTemplateId(): string | undefined {
    if (!this.syncBridge) return undefined
    const repo = this.syncBridge.getRepo()
    const latestId = repo.findLatestFrameMessageId()
    if (latestId == null) return undefined
    const frame = repo.loadFrame(latestId)
    return frame?.templateId
  }

  loadFromChat(): boolean {
    if (!this.syncBridge) {
      throw new Error('session not initialized')
    }
    const result = this.syncBridge.load(this.template ?? undefined)
    this.lastSnapshotIndex = result.snapshotIndex
    if (!result.ok) {
      pushLog('warn', 'session', `数据库快照加载失败: ${result.warnings.join('; ')}`)
      return false
    }
    if (result.warnings.length > 0) {
      pushLog('warn', 'session', `数据库快照 schema 警告: ${result.warnings.join('; ')}`)
    }
    return true
  }

  getLastLoadWarnings(): string[] {
    return this.syncBridge?.lastLoadWarnings ?? []
  }

  getLoadDiagnostic(): { snapshotIndex: number | null; snapshotCount: number; lastAiIndex: number | null } {
    const chat = this.chat.getChat()
    let lastAiIndex: number | null = null
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i]
      if (msg && !msg.is_user) {
        lastAiIndex = i
        break
      }
    }
    return {
      snapshotIndex: this.lastSnapshotIndex,
      snapshotCount: this.syncBridge?.countSnapshots() ?? 0,
      lastAiIndex
    }
  }

  listSnapshotIndices(): number[] {
    return this.syncBridge?.listSnapshotIndices() ?? []
  }

  exportSnapshot(): import('@shared/types/checkpoint-file').TableCheckpointFileV1 {
    return exportCheckpoint(this)
  }

  importSnapshot(file: import('@shared/types/checkpoint-file').TableCheckpointFileV1): { ok: boolean; error?: string } {
    const valid = validateCheckpointFile(file)
    if (!valid.ok) return valid
    const repo = this.getSyncBridgeRepo()
    if (!repo || !this.syncBridge) {
      return { ok: false, error: 'session not initialized' }
    }
    try {
      this.syncBridge.applySnapshotExternal(file.tableSnapshot)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    const targetId = this.getLastAiMessageId() ?? 0
    this.syncBridge.writeCheckpoint(targetId, 'import')
    return { ok: true }
  }

  recoverSnapshotAt(index: number): boolean {
    if (!this.syncBridge) {
      throw new Error('session not initialized')
    }
    const result = this.syncBridge.loadSnapshotAt(index)
    this.lastSnapshotIndex = result.snapshotIndex
    if (!result.ok) {
      pushLog('warn', 'session', `手动恢复快照失败: ${result.warnings.join('; ')}`)
      return false
    }
    return true
  }

  saveToChat(messageId: number): void {
    if (!this.syncBridge) {
      throw new Error('session not initialized')
    }
    const cfg = this.config.read()
    const tplId = this.currentTemplateId ?? undefined
    if (cfg.snapshotStrategy === 'latest-only') {
      this.syncBridge.removeAllSnapshots()
      this.syncBridge.writeCheckpoint(messageId, 'manual', tplId)
    } else {
      this.syncBridge.save(messageId, tplId)
    }
  }

  private getLastAiMessageId(): number | null {
    const chat = this.chat.getChat()
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i]
      if (msg && !msg.is_user && !msg.is_system) {
        return i
      }
    }
    return null
  }

  getLastUserIdx(): number {
    const chat = this.chat.getChat()
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i]
      if (msg && msg.is_user) {
        return i
      }
    }
    return -1
  }

  private appendManualLog(statements: string[], params?: (string | number | null)[][]): void {
    if (!this.syncBridge) return
    const targetId = this.getLastAiMessageId()
    if (targetId == null) return
    this.syncBridge.appendManualSqlLog(targetId, statements, params)
  }

  cleanupOldSnapshots(retainFloors: number): void {
    this.syncBridge?.cleanupOldSnapshots(retainFloors)
  }

  getConfig(): CranialNerveConfig {
    return this.config.read()
  }

  getChronicleTableDef(): TableDef {
    return this.config.read().chronicleTableDef ?? DEFAULT_CHRONICLE_TABLE
  }

  saveConfig(config: CranialNerveConfig): void {
    this.config.write(config)
  }

  getActiveAiPreset(): AiPreset | null {
    const cfg = this.config.read()
    return cfg.aiPresets.find((p) => p.id === cfg.activeAiPresetId) ?? null
  }

  getAiPresetForScene(scenePresetId: string): AiPreset | null {
    const cfg = this.config.read()
    if (scenePresetId) {
      const scenePreset = cfg.aiPresets.find((p) => p.id === scenePresetId)
      if (scenePreset) return scenePreset
    }
    return this.getActiveAiPreset()
  }

  getActivePromptPreset(): ScenePreset | null {
    const cfg = this.config.read()
    const scene = cfg.prompt.tableEdit
    return scene.presets.find((p) => p.id === scene.activeId) ?? scene.presets[0] ?? null
  }

  getActiveSegments(scene: PromptSceneKey): PromptSegment[] {
    const cfg = this.config.read()
    const sc = cfg.prompt[scene]
    const preset = sc.presets.find((p) => p.id === sc.activeId) ?? sc.presets[0]
    return preset?.segments ?? []
  }

  async listModels(preset: AiPreset): Promise<string[]> {
    return this.config.listModels(preset, this.getConfig().pending.listModelsTimeoutMs)
  }

  getTableData(tableName: string): QueryResult[] {
    return this.core.exec(`SELECT * FROM "${tableName.replace(/"/g, '""')}"`)
  }

  getTableRowsWithRowid(tableName: string): QueryResult[] {
    const safe = tableName.replace(/"/g, '""')
    return this.core.exec(`SELECT rowid AS __rowid__, * FROM "${safe}"`)
  }

  updateCell(tableName: string, rowid: number, column: string, value: string): void {
    const safeTable = tableName.replace(/"/g, '""')
    const safeCol = column.replace(/"/g, '""')
    const sql = `UPDATE "${safeTable}" SET "${safeCol}" = ? WHERE rowid = ?`
    this.core.run(sql, [value, rowid])
    this.appendManualLog([sql], [[value, rowid]])
  }

  deleteRow(tableName: string, rowid: number): void {
    const safe = tableName.replace(/"/g, '""')
    const sql = `DELETE FROM "${safe}" WHERE rowid = ?`
    this.core.run(sql, [rowid])
    this.appendManualLog([sql], [[rowid]])
  }

  insertRow(tableName: string, values: Record<string, string>): void {
    const safeTable = tableName.replace(/"/g, '""')
    const cols = Object.keys(values).map((c) => `"${c.replace(/"/g, '""')}"`)
    const placeholders = cols.map(() => '?').join(', ')
    const sql = `INSERT INTO "${safeTable}" (${cols.join(', ')}) VALUES (${placeholders})`
    this.core.run(sql, Object.values(values))
    this.appendManualLog([sql], [Object.values(values)])
  }

  listTables(): string[] {
    return this.core.listTables()
  }

  getTableDef(tableName: string): TableDef | null {
    return this.template?.tables.find((t) => t.name === tableName) ?? null
  }

  getTableEditor(): TableEditor {
    if (!this.tableEditor) {
      throw new Error('session not initialized')
    }
    return this.tableEditor
  }

  getNameMapper(): NameMapper | null {
    return this.nameMapper
  }

  getTemplate(): CardTemplate | null {
    return this.template
  }

  getCurrentTemplateId(): string | null {
    return this.currentTemplateId
  }

  getChronicleRecaller(): ChronicleRecaller | null {
    return this.chronicleRecaller
  }

  getChronicleStore(): ChronicleEntryStore | null {
    return this.chronicleStore
  }

  getWriteQueue(): WriteQueue {
    return this.writeQueue
  }

  getSyncBridgeRepo(): import('@db/sqlite/storage-frame-repo').FrameRepo | null {
    return this.syncBridge?.getRepo() ?? null
  }

  runWrite<T>(task: () => Promise<T> | T): Promise<T> {
    return this.writeQueue.enqueue(() => Promise.resolve(task()))
  }

  async applyChronicleTableDef(def: TableDef): Promise<void> {
    await this.runWrite(async () => {
      const hasChronicle = this.core.listTables().includes(CHRONICLE_TABLE_NAME)
      const oldRows = hasChronicle ? (this.getTableRowsWithRowid(CHRONICLE_TABLE_NAME)[0]?.rows ?? []) : []
      this.core.transaction(() => {
        this.core.run(`DROP TABLE IF EXISTS ${quoteIdent(CHRONICLE_TABLE_NAME)}`)
        this.core.run(buildCreateTableSql(def))
        if (def.columns.length > 0) {
          const cols = def.columns.map((c) => quoteIdent(c.name))
          const placeholders = def.columns.map(() => '?').join(', ')
          const sql = `INSERT INTO ${quoteIdent(CHRONICLE_TABLE_NAME)} (${cols.join(', ')}) VALUES (${placeholders})`
          for (const row of oldRows) {
            const values = def.columns.map((c) => {
              const v = (row as Record<string, unknown>)[c.name]
              return v == null ? '' : String(v)
            })
            try {
              this.core.run(sql, values)
            } catch (e) {
              pushLog('warn', 'session', `applyChronicleTableDef 跳过冲突行: ${e instanceof Error ? e.message : String(e)}`)
            }
          }
        }
      })
      const cfg = this.getConfig()
      cfg.chronicleTableDef = def
      this.saveConfig(cfg)
      const chat = this.chat.getChat()
      const lastMsgId = chat.length - 1
      if (lastMsgId >= 0) {
        this.saveToChat(lastMsgId)
      }
      try {
        await syncToWorldbook(this)
        await this.chat.saveChat()
      } catch (e) {
        pushLog('error', 'session', `applyChronicleTableDef 同步失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }

  setProgressNotifier(fn: ProgressStarter): void {
    this.progressNotifier = fn
  }

  getProgressNotifier(): ProgressStarter | undefined {
    return this.progressNotifier
  }

  setToastNotifier(fn: ToastNotifier): void {
    this.toastNotifier = fn
  }

  getToastNotifier(): ToastNotifier | undefined {
    return this.toastNotifier
  }

  setRecallCardRenderer(fn: (msgId: number) => void): void {
    this.recallCardRenderer = fn
  }
}

let sessionInstance: CranialNerveSession | null = null

export function getSession(): CranialNerveSession {
  if (!sessionInstance) {
    sessionInstance = new CranialNerveSession()
  }
  return sessionInstance
}
