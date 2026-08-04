import type { AiChatMessage } from '@db/gateways/ai'
import { SQL_ERROR_MARKER_CLOSE, SQL_ERROR_MARKER_OPEN } from '@shared/constants/sql-json'

export function buildFeedbackMessages(
    baseMessages: AiChatMessage[],
    lastRaw: string,
    lastError: string,
): AiChatMessage[] {
    const feedback = `${SQL_ERROR_MARKER_OPEN}上次输出存在错误，请根据以下信息修正后重新输出完整的 JSON。

错误信息：${lastError}

修正要求：
1. 检查 SQL 语法是否正确
2. 确认表名、列名与 DDL 完全一致（英文物理名）
3. UPDATE/DELETE 必须带 WHERE 条件
4. 字符串值用单引号包裹，内部单引号用两个单引号转义
5. 只输出 {"format":"...","sql":"..."} 格式的 JSON，不要输出其他内容${SQL_ERROR_MARKER_CLOSE}`
    return [
        ...baseMessages,
        { role: 'assistant', content: lastRaw },
        { role: 'user', content: feedback },
    ]
}
