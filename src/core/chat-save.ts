import type { CranialNerveSession } from './session'
import { pushLog } from '@shared/log-buffer'

const SAVE_DELAY_MS = 500

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSession: CranialNerveSession | null = null

function doSave(session: CranialNerveSession): Promise<void> {
  return session.runWrite(async () => {
    try {
      await session.chat.saveChat()
    } catch (e) {
      pushLog('error', 'session', `saveChat 失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
}

export function scheduleChatSave(session: CranialNerveSession): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
  }
  pendingSession = session
  saveTimer = setTimeout(() => {
    saveTimer = null
    const target = pendingSession
    pendingSession = null
    if (target) {
      doSave(target)
    }
  }, SAVE_DELAY_MS)
}

export function flushChatSave(session: CranialNerveSession): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  pendingSession = null
  return doSave(session)
}
