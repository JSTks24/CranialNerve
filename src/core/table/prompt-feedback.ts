import type { AiChatMessage } from '@db/gateways/ai'
import { SQL_ERROR_MARKER_CLOSE, SQL_ERROR_MARKER_OPEN } from '@shared/constants/sql-json'

export function buildFeedbackMessages(
    baseMessages: AiChatMessage[],
    lastRaw: string,
    lastError: string,
): AiChatMessage[] {
    const feedback = `${SQL_ERROR_MARKER_OPEN}上次 SQL 执行失败，错误信息：${lastError}。请修正后重新输出。${SQL_ERROR_MARKER_CLOSE}`
    return [
        ...baseMessages,
        { role: 'assistant', content: lastRaw },
        { role: 'user', content: feedback },
    ]
}
