import { stripKeyLineFromMes } from '@shared/recall-payload'
import { RECALL_FADE_MIN_DEPTH } from '@shared/constants'

const GLOBAL_KEY = 'cnGenerateInterceptor'

interface InterceptorChatItem {
  is_user?: boolean
  mes?: unknown
}

export function registerGenerateInterceptor(): void {
  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = (chat: InterceptorChatItem[]): void => {
    for (let i = 0; i < chat.length; i++) {
      const item = chat[i]
      if (!item || item.is_user !== true) {
        continue
      }
      const depth = chat.length - 1 - i
      if (depth < RECALL_FADE_MIN_DEPTH) {
        continue
      }
      if (typeof item.mes !== 'string') {
        continue
      }
      const stripped = stripKeyLineFromMes(item.mes)
      if (stripped !== item.mes) {
        item.mes = stripped
      }
    }
  }
}
