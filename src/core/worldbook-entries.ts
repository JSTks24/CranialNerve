import type { WorldbookGateway } from '@db/gateways/worldbook'
import type { ChronicleEntry, WorldInfoEntry } from '@shared/types/worldbook'
import {
  CHRONICLE_KEY_PAD,
  CHRONICLE_KEY_PREFIX,
  WORLDBOOK_ORDER_MAX,
  WORLDBOOK_ORDER_MIN
} from '@shared/constants/worldbook'

const KEY_REGEX = new RegExp(`^${CHRONICLE_KEY_PREFIX}(\\d+)$`)

export type ChronicleDraft = Omit<ChronicleEntry, 'key'>

export default class ChronicleEntryStore {
  private readonly worldbook: WorldbookGateway
  private readonly lorebookName: string

  constructor(worldbook: WorldbookGateway, lorebookName: string) {
    this.worldbook = worldbook
    this.lorebookName = lorebookName
  }

  async add(draft: ChronicleDraft): Promise<number> {
    const data = await this.worldbook.loadLorebook(this.lorebookName)
    const nextSeq = this.maxSeq(data.entries) + 1
    const key = formatKey(nextSeq)
    const usedOrders = collectUsedOrders(data.entries)
    const order = findFirstFreeOrder(usedOrders)
    const uid = nextUid(data.entries)

    data.entries[String(uid)] = toWorldInfoEntry(uid, key, draft, order)
    await this.worldbook.saveLorebook(this.lorebookName, data)
    return uid
  }

  async list(): Promise<ChronicleEntry[]> {
    const data = await this.worldbook.loadLorebook(this.lorebookName)
    return chronicleEntries(data.entries)
  }

  async findByKey(key: string): Promise<ChronicleEntry | null> {
    const data = await this.worldbook.loadLorebook(this.lorebookName)
    for (const entry of Object.values(data.entries) as WorldInfoEntry[]) {
      if (entry.key.includes(key)) {
        return toChronicleEntry(entry)
      }
    }
    return null
  }

  async removeByKey(key: string): Promise<boolean> {
    const data = await this.worldbook.loadLorebook(this.lorebookName)
    for (const [uid, entry] of Object.entries(data.entries) as [string, WorldInfoEntry][]) {
      if (entry.key.includes(key)) {
        delete data.entries[uid]
        await this.worldbook.saveLorebook(this.lorebookName, data)
        return true
      }
    }
    return false
  }

  private maxSeq(entries: Record<string, WorldInfoEntry>): number {
    let max = 0
    for (const entry of Object.values(entries)) {
      const match = entry.key.find((k) => KEY_REGEX.test(k))
      if (match) {
        const seq = Number.parseInt(KEY_REGEX.exec(match)?.[1] ?? '0', 10)
        if (seq > max) {
          max = seq
        }
      }
    }
    return max
  }
}

function formatKey(seq: number): string {
  return `${CHRONICLE_KEY_PREFIX}${String(seq).padStart(CHRONICLE_KEY_PAD, '0')}`
}

function nextUid(entries: Record<string, WorldInfoEntry>): number {
  let max = -1
  for (const uid of Object.keys(entries)) {
    const n = Number.parseInt(uid, 10)
    if (Number.isFinite(n) && n > max) {
      max = n
    }
  }
  return max + 1
}

function collectUsedOrders(entries: Record<string, WorldInfoEntry>): Set<number> {
  const used = new Set<number>()
  for (const entry of Object.values(entries)) {
    if (Number.isFinite(entry.order)) {
      used.add(entry.order)
    }
  }
  return used
}

function findFirstFreeOrder(used: Set<number>): number {
  for (let o = WORLDBOOK_ORDER_MIN; o <= WORLDBOOK_ORDER_MAX; o++) {
    if (!used.has(o)) {
      return o
    }
  }
  return WORLDBOOK_ORDER_MIN
}

function toWorldInfoEntry(
  uid: number,
  key: string,
  draft: ChronicleDraft,
  order: number
): WorldInfoEntry {
  return {
    uid,
    key: [key],
    content: JSON.stringify({ ...draft, key }),
    comment: key,
    constant: false,
    selective: true,
    position: 0,
    role: 0,
    depth: 4,
    order,
    displayIndex: uid,
    disable: false
  }
}

function toChronicleEntry(entry: WorldInfoEntry): ChronicleEntry | null {
  const key = entry.key.find((k) => KEY_REGEX.test(k))
  if (!key) {
    return null
  }
  try {
    const parsed = JSON.parse(entry.content) as ChronicleEntry
    return { ...parsed, key }
  } catch {
    return { key, content: { summary: entry.content } }
  }
}

function chronicleEntries(entries: Record<string, WorldInfoEntry>): ChronicleEntry[] {
  const out: ChronicleEntry[] = []
  for (const entry of Object.values(entries)) {
    const ce = toChronicleEntry(entry)
    if (ce) {
      out.push(ce)
    }
  }
  return out
}
