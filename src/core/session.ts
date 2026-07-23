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
import { validateTimeRegistration } from './time'
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
import { cleanupStaleBooks, syncToWorldbook } from './worldbook-sync'
import { resetFillScheduler } from './table/fill-orchestrator'

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
    await this.reloadForChatChange()
  }

  private setupChronicle(): void {
    const name = this.worldbook.getCurrentCharLorebookName()
    if (!name) {
      this.chronicleStore = null
      this.chronicleRecaller = null
      return
    }
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
    this.currentChatToken = null
    this.core.dispose()
    await this.core.init()
    this.nameMapper = null
    this.template = null
    resetFillScheduler()
    this.setupChronicle()
    try {
      this.initGameSessionFromCard()
    } catch (e) {
      console.warn('[CranialNerve] 角色卡模板数据异常:', e instanceof Error ? e.message : e)
    }
    this.core.run(buildCreateTableSql(DEFAULT_CHRONICLE_TABLE))
    this.loadFromChat()
    await this.setupWorldbook()
  }

  getChatToken(): string {
    if (this.currentChatToken) {
      return this.currentChatToken
    }
    try {
      const ctx = getHostContext()
      const parts: string[] = []
      if (ctx.characterId != null) {
        parts.push(String(ctx.characterId))
      }
      const chat = ctx.chat
      if (chat && chat.length > 0) {
        const firstMsg = chat[0]
        if (firstMsg && firstMsg.send_date) {
          parts.push(String(firstMsg.send_date))
        }
      }
      if (parts.length > 0) {
        this.currentChatToken = parts.join('_')
        return this.currentChatToken
      }
    } catch {}
    this.currentChatToken = `cn_${Date.now().toString(36)}`
    return this.currentChatToken
  }

  private async setupWorldbook(): Promise<void> {
    try {
      await cleanupStaleBooks(this)
      await syncToWorldbook(this)
    } catch {
    }
  }

  initGameSession(template: CardTemplate): void {
    validateTimeRegistration()
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
    if (!result.ok) {
      console.warn('[CranialNerve] 数据库快照加载失败:', result.warnings.join('; '))
      return false
    }
    if (result.warnings.length > 0) {
      console.warn('[CranialNerve] 数据库快照 schema 警告:', result.warnings.join('; '))
    }
    return true
  }

  getLastLoadWarnings(): string[] {
    return this.syncBridge?.lastLoadWarnings ?? []
  }

  saveToChat(messageId: number): void {
    if (!this.syncBridge) {
      throw new Error('session not initialized')
    }
    const cfg = this.config.read()
    if (cfg.snapshotStrategy === 'latest-only') {
      this.syncBridge.removeAllSnapshots()
    }
    this.syncBridge.save(messageId)
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
    this.core.run(`UPDATE "${safeTable}" SET "${safeCol}" = ? WHERE rowid = ?`, [value, rowid])
  }

  deleteRow(tableName: string, rowid: number): void {
    const safe = tableName.replace(/"/g, '""')
    this.core.run(`DELETE FROM "${safe}" WHERE rowid = ?`, [rowid])
  }

  insertRow(tableName: string, values: Record<string, string>): void {
    const safeTable = tableName.replace(/"/g, '""')
    const cols = Object.keys(values).map((c) => `"${c.replace(/"/g, '""')}"`)
    const placeholders = cols.map(() => '?').join(', ')
    this.core.run(
      `INSERT INTO "${safeTable}" (${cols.join(', ')}) VALUES (${placeholders})`,
      Object.values(values)
    )
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
}

let sessionInstance: CranialNerveSession | null = null

export function getSession(): CranialNerveSession {
  if (!sessionInstance) {
    sessionInstance = new CranialNerveSession()
  }
  return sessionInstance
}
