import { getHostContext, getRequestHeaders } from './host-context'

export const METADATA_KEY = 'world_info'

export interface WorldbookGateway {
  getCurrentCharLorebookName(): string | null
  loadLorebook(name: string): Promise<WorldInfoData>
  saveLorebook(name: string, data: WorldInfoData): Promise<void>
  createWorldbook(name: string): Promise<void>
  deleteWorldbook(name: string): Promise<void>
  listWorldbookNames(): string[]
  isAttachedToChat(name: string): boolean
  attachToChat(name: string): Promise<void>
  detachFromChat(): Promise<void>
  detachFromChatSync(): void
}

export default function createWorldbookGateway(): WorldbookGateway {
  return {
    getCurrentCharLorebookName() {
      const ctx = getHostContext()
      const id = ctx.characterId
      if (id == null) {
        return null
      }
      const world = ctx.characters[Number(id)]?.data?.extensions?.['world']
      return typeof world === 'string' ? world : null
    },
    async loadLorebook(name) {
      const ctx = getHostContext()
      if (typeof ctx.loadWorldInfo !== 'function') {
        throw new Error('loadWorldInfo unavailable')
      }
      const data = await ctx.loadWorldInfo(name)
      if (!data) {
        throw new Error(`lorebook "${name}" not found`)
      }
      return data
    },
    async saveLorebook(name, data) {
      const ctx = getHostContext()
      if (typeof ctx.saveWorldInfo !== 'function') {
        throw new Error('saveWorldInfo unavailable')
      }
      await ctx.saveWorldInfo(name, data)
    },
    async createWorldbook(name) {
      const ctx = getHostContext()
      if (typeof ctx.saveWorldInfo !== 'function') {
        throw new Error('saveWorldInfo unavailable')
      }
      const empty: WorldInfoData = { entries: {} }
      await ctx.saveWorldInfo(name, empty)
    },
    async deleteWorldbook(name) {
      const ctx = getHostContext()
      const headers = getRequestHeaders()
      headers['Content-Type'] = 'application/json'
      try {
        const res = await fetch('/api/worldinfo/delete', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name }),
        })
        if (!res.ok) {
          throw new Error(`删除世界书失败：${res.status}`)
        }
      } finally {
        if (typeof ctx.updateWorldInfoList === 'function') {
          await ctx.updateWorldInfoList()
        }
      }
    },
    listWorldbookNames() {
      const ctx = getHostContext()
      if (typeof ctx.getWorldInfoNames !== 'function') {
        return []
      }
      return ctx.getWorldInfoNames()
    },
    isAttachedToChat(name) {
      const ctx = getHostContext()
      return ctx.chatMetadata[METADATA_KEY] === name
    },
    async attachToChat(name) {
      const ctx = getHostContext()
      ctx.chatMetadata[METADATA_KEY] = name
      if (typeof ctx.saveMetadata === 'function') {
        await ctx.saveMetadata()
      }
    },
    async detachFromChat() {
      const ctx = getHostContext()
      delete ctx.chatMetadata[METADATA_KEY]
      if (typeof ctx.saveMetadata === 'function') {
        await ctx.saveMetadata()
      }
    },
    detachFromChatSync() {
      const ctx = getHostContext()
      delete ctx.chatMetadata[METADATA_KEY]
    },
  }
}
