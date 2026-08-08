import { stripKeyLineFromMes } from '@shared/recall-payload'
import { resolveFadeMinDepth } from '@shared/constants'

const GLOBAL_KEY = 'cnGenerateInterceptor'

interface InterceptorChatItem {
  is_user?: boolean
  mes?: unknown
}

export function registerGenerateInterceptor(getFadeDepth?: () => number): void {
  ;(globalThis as Record<string, unknown>)[GLOBAL_KEY] = (chat: InterceptorChatItem[]): void => {
    let value: unknown
    try {
      value = getFadeDepth?.()
    } catch {}
    const fadeMin = resolveFadeMinDepth(value)
    if (fadeMin <= 0) {
      return
    }
    for (let i = 0; i < chat.length; i++) {
      const item = chat[i]
      if (!item || item.is_user !== true) {
        continue
      }
      const depth = chat.length - 1 - i
      if (depth < fadeMin) {
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
