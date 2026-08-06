export interface WorldInfoEntry {
  uid: number
  key: string[]
  content: string
  comment: string
  constant: boolean
  selective: boolean
  position: number | string
  role: number
  depth: number
  order: number
  displayIndex: number
  disable: boolean
  keysecondary?: string[]
  [key: string]: unknown
}

export interface WorldInfoData {
  name?: string
  entries: Record<string, WorldInfoEntry>
}

export interface ChronicleContent {
  summary?: string
  storyTime?: string
  importantWord?: string
  [key: string]: string | undefined
}

export interface ChronicleEntry {
  key: string
  timeStart?: string
  timeEnd?: string
  content: ChronicleContent
}
