import { getHostContext } from './host-context'

export const METADATA_KEY = 'world_info'

export interface WorldbookGateway {
  getCurrentCharLorebookName(): string | null
  loadLorebook(name: string): Promise<WorldInfoData>
  saveLorebook(name: string, data: WorldInfoData): Promise<void>
  createWorldbook(name: string): Promise<void>
  deleteWorldbook(name: string): Promise<void>
  listWorldbookNames(): string[]
  attachToChat(name: string): Promise<void>
  detachFromChat(): Promise<void>
}

export default function createWorldbookGateway(): WorldbookGateway {
  return {
    getCurrentCharLorebookName() {
      const ctx = getHostContext()
      const id = ctx.characterId
      if (id == null) {
        return null
      }
      const world = ctx.characters[id as number]?.data?.extensions?.['world']
      return typeof world === 'string' ? world : null
    },
    async loadLorebook(name) {
      if (!window.loadWorldInfo) {
        throw new Error('loadWorldInfo unavailable')
      }
      const data = await window.loadWorldInfo(name)
      if (!data) {
        throw new Error(`lorebook "${name}" not found`)
      }
      return data
    },
    async saveLorebook(name, data) {
      if (!window.saveWorldInfo) {
        throw new Error('saveWorldInfo unavailable')
      }
      await window.saveWorldInfo(name, data)
    },
    async createWorldbook(name) {
      if (!window.createNewWorldInfo) {
        const empty: WorldInfoData = { entries: {} }
        await window.saveWorldInfo!(name, empty)
        return
      }
      await window.createNewWorldInfo(name)
    },
    async deleteWorldbook(name) {
      if (!window.deleteWorldInfo) {
        throw new Error('deleteWorldInfo unavailable')
      }
      await window.deleteWorldInfo(name)
    },
    listWorldbookNames() {
      if (!window.getWorldInfoNames) {
        return []
      }
      return window.getWorldInfoNames()
    },
    async attachToChat(name) {
      const ctx = getHostContext()
      ctx.chatMetadata[METADATA_KEY] = name
      if (window.saveMetadata) {
        await window.saveMetadata()
      }
    },
    async detachFromChat() {
      const ctx = getHostContext()
      delete ctx.chatMetadata[METADATA_KEY]
    }
  }
}
