import SqliteCore from '@db/sqlite/core'
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
  ChatGateway,
  CharacterGateway,
  EventGateway,
  VectorGateway,
  WorldbookGateway
} from '@db/gateways'
import type { ConfigGateway } from '@db/gateways/config'
import SqliteSyncBridge from '@db/sqlite/sync-bridge'
import NameMapper from '@shared/namemapper'
import { buildCreateTableSql } from '@shared/template-builder'
import { DEFAULT_CHRONICLE_TABLE, CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'
import { validateTimeRegistration, clearTimeRegistration } from './time'
import { EVENT_CHAT_CHANGED } from '@shared/constants/events'
import type { CardTemplate } from '@shared/types/card'
import type { QueryResult, TableDef } from '@shared/types/table'
import type {
  CranialNerveConfig,
  AiPreset,
  ScenePreset,
  PromptSegment,
  PromptSceneKey
} from '@shared/types/config'
import { TableEditor } from './table'
import ChronicleEntryStore from './worldbook-entries'
import type { ChronicleEntry } from '@shared/types/worldbook'
import createChronicleRecaller, { type ChronicleRecaller } from './chronicle'
import createWriteQueue, { type WriteQueue } from './write-queue'
import { buildBookName, cleanupStaleBooks, syncToWorldbook } from './worldbook-sync'
import { resetFillScheduler, onGenerationEnded } from './table/fill-orchestrator'
import { onPromptReady } from './chronicle/recall-orchestrator'
import { exportCheckpoint, validateCheckpointFile } from './checkpoint-transfer'
import { pushLog } from '@shared/log-buffer'
import { EVENT_GENERATION_ENDED, EVENT_CHAT_COMPLETION_PROMPT_READY, EVENT_CHAT_RENAMED } from '@shared/constants/events'

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
  private chronicleStore: ChronicleEntryStore | null = null
  private chronicleRecaller: ChronicleRecaller | null = null
  private writeQueue: WriteQueue
  private currentChatToken: string | null = null
  private autoSwitchHandler: ((...args: unknown[]) => unknown) | null = null
  private reloadSeq = 0
  private lastSnapshotIndex: number | null = null

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
    await this.core.init()
    this.syncBridge = new SqliteSyncBridge(this.core, this.chat)
    this.tableEditor = new TableEditor(this.core, this.ai)
    this.startAutoSwitch()
    this.bindCoreEvents()
    await this.reloadForChatChange()
  }

  private eventsBound = false
  private bindCoreEvents(): void {
    if (this.eventsBound) return
    this.eventsBound = true
    this.event.makeLast(EVENT_GENERATION_ENDED, () => {
      onGenerationEnded(this).catch((e) => {
        pushLog('error', 'session', `onGenerationEnded error: ${e instanceof Error ? e.message : String(e)}`)
      })
    })
    this.event.makeLast(EVENT_CHAT_COMPLETION_PROMPT_READY, (...args: unknown[]) => {
      const eventData = args[0] as { chat: SillyTavernChatMessage[]; dryRun?: boolean }
      if (eventData) {
        onPromptReady(this, eventData).catch((e) => {
          pushLog('error', 'session', `onPromptReady error: ${e instanceof Error ? e.message : String(e)}`)
        })
      }
    })
    this.event.on(EVENT_CHAT_RENAMED, (...args: unknown[]) => {
      const payload = args[0] as { oldFileName?: string; newFileName?: string } | undefined
      if (payload?.oldFileName && payload?.newFileName) {
        this.renameWorldbook(payload.oldFileName, payload.newFileName).catch((e) => {
          pushLog('error', 'session', `世界书重命名失败: ${e instanceof Error ? e.message : String(e)}`)
        })
      }
    })
  }

  private setupChronicle(): void {
    const name = buildBookName(this.getChatToken())
    this.chronicleStore = new ChronicleEntryStore(this.worldbook, name)
    const tableReader = async (): Promise<ChronicleEntry[]> => {
      const result = this.core.exec(`SELECT * FROM "${CHRONICLE_TABLE_NAME}"`)
      const first = result[0]
      if (!first) return []
      return first.rows.map((r) => ({
        key: String(r.key ?? ''),
        timeStart: String(r.time_start ?? ''),
        timeEnd: String(r.time_end ?? ''),
        content: {
          summary: String(r.chronicle_text ?? ''),
          storyTime: String(r.time_start ?? ''),
          keyDialogue: String(r.key_dialogue ?? ''),
          location: String(r.location ?? '')
        }
      }))
    }
    this.chronicleRecaller = createChronicleRecaller(this.ai, tableReader, this.vector)
  }

  startAutoSwitch(): void {
    if (this.autoSwitchHandler) {
      return
    }
    const handler = async () => {
      await this.reloadForChatChange()
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
    await this.writeQueue.waitForDrain()
    if (mySeq !== this.reloadSeq) {
      return
    }
    if (prevToken) {
      clearTimeRegistration(prevToken)
    }
    this.currentChatToken = null
    this.core.dispose()
    await this.core.init()
    if (mySeq !== this.reloadSeq) {
      return
    }
    this.nameMapper = null
    this.template = null
    resetFillScheduler()
    this.setupChronicle()
    try {
      this.initGameSessionFromCard()
    } catch (e) {
      console.warn('[CranialNerve] 角色卡模板数据异常:', e instanceof Error ? e.message : e)
    }
    if (mySeq !== this.reloadSeq) {
      return
    }
    this.core.run(buildCreateTableSql(DEFAULT_CHRONICLE_TABLE))
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

  private async setupWorldbook(mySeq: number): Promise<void> {
    if (mySeq !== this.reloadSeq) {
      return
    }
    try {
      await cleanupStaleBooks(this)
      if (mySeq !== this.reloadSeq) {
        return
      }
      await syncToWorldbook(this)
    } catch (e) {
      console.error('[CranialNerve] 世界书初始化失败:', e)
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

  initGameSession(template: CardTemplate): void {
    validateTimeRegistration(this.getChatToken())
    this.template = template
    this.nameMapper = new NameMapper(template.tables)
    for (const table of template.tables) {
      this.core.run(buildCreateTableSql(table))
    }
    this.core.run(buildCreateTableSql(DEFAULT_CHRONICLE_TABLE))
  }

  initGameSessionFromCard(): CardTemplate | null {
    const template = this.character.readTemplateFromCard()
    if (template) {
      this.initGameSession(template)
    }
    return template
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
    if (cfg.snapshotStrategy === 'latest-only') {
      this.syncBridge.removeAllSnapshots()
      this.syncBridge.writeCheckpoint(messageId, 'manual')
    } else {
      this.syncBridge.save(messageId)
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
    return preset?.blocks.flatMap((b) => b.segments) ?? []
  }

  async listModels(preset: AiPreset): Promise<string[]> {
    return this.config.listModels(preset)
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
}

let sessionInstance: CranialNerveSession | null = null

export function getSession(): CranialNerveSession {
  if (!sessionInstance) {
    sessionInstance = new CranialNerveSession()
  }
  return sessionInstance
}
