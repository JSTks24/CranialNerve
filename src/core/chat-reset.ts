import type { CranialNerveSession } from './session'
import { deleteAllCnBooks } from './worldbook-sync'
import { MSG_FIELD_PREFIX, RECALL_FIELD_PREFIX } from '@shared/constants/msg-fields'

export async function clearChatData(session: CranialNerveSession): Promise<void> {
  const messages = session.chat.getChat()
  for (const msg of messages) {
    const extra = msg?.extra
    if (!extra || typeof extra !== 'object') continue
    const hadRecall = RECALL_FIELD_PREFIX in extra
    for (const key of Object.keys(extra)) {
      if (key.startsWith(MSG_FIELD_PREFIX)) {
        delete extra[key]
      }
    }
    if (hadRecall) {
      delete extra.display_text
    }
  }
  session.chat.writeChatMetadata('CN_TEMPLATE', undefined)
  session.chat.writeChatMetadata('CN_FILL_PROGRESS', undefined)
  await deleteAllCnBooks(session)
  await session.vectorIndexStore.remove(session.getChatToken())
  await session.chat.saveChat()
}
