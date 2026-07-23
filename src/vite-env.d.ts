/// <reference types="vite/client" />

declare module '*.css?inline' {
  const css: string
  export default css
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

interface Window {
  SillyTavern?: {
    getContext(): SillyTavernContext
  }
  loadWorldInfo?: (name: string) => Promise<WorldInfoData>
  saveWorldInfo?: (name: string, data: WorldInfoData, immediately?: boolean) => Promise<void>
  deleteWorldInfo?: (name: string) => Promise<void>
  createNewWorldInfo?: (name: string) => Promise<void>
  getWorldInfoNames?: () => string[]
  saveMetadata?: () => Promise<void>
}

declare function $(handler: () => void): void

interface SillyTavernContext {
  characterId: number | null
  characters: SillyTavernCharacter[]
  chat: SillyTavernChatMessage[]
  chatMetadata: Record<string, unknown>
  extensionSettings: Record<string, unknown>
  eventSource: SillyTavernEventSource
  eventTypes: Record<string, string>
  name1: string
  name2: string
}

interface SillyTavernEventSource {
  on(event: string, handler: (...args: unknown[]) => unknown): void
  off(event: string, handler: (...args: unknown[]) => unknown): void
  makeLast(event: string, handler: (...args: unknown[]) => unknown): void
}

interface SillyTavernCharacter {
  avatar: string
  data?: {
    extensions?: Record<string, unknown>
  }
}

interface SillyTavernChatMessage {
  mes: string
  is_user: boolean
  is_system: boolean
  send_date: string
  extra?: Record<string, unknown>
  [key: string]: unknown
}

interface WorldInfoData {
  name?: string
  entries: Record<string, WorldInfoEntry>
}

interface WorldInfoEntry {
  uid: number
  key: string[]
  content: string
  comment: string
  constant: boolean
  selective: boolean
  position: number
  role: number
  depth: number
  order: number
  displayIndex: number
  disable: boolean
  [key: string]: unknown
}
