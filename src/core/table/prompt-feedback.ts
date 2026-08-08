import type { AiChatMessage } from '@db/gateways/ai'
import { SQL_ERROR_MARKER_CLOSE, SQL_ERROR_MARKER_OPEN } from '@shared/constants/sql-json'

export function buildFeedbackMessages(
    baseMessages: AiChatMessage[],
    lastRaw: string,
    lastError: string,
    runMode?: 'table' | 'chronicle' | 'merged',
): AiChatMessage[] {
    const rule6 = runMode === 'table'
        ? 'table 模式某轮无变更时该元素 sql 留空字符串 ""'
        : runMode === 'chronicle'
            ? 'chronicle 模式每个元素 sql 必须包含对纪要表的 INSERT，sql 不允许为空'
            : runMode === 'merged'
                ? 'merged 模式每个元素 sql 必须同时包含该轮普通表变更（无变更则该层只写纪要）与一条对纪要表的 INSERT；sql 不允许为空字符串；系统会自动分类，无需标注；表格变更与纪要同等重要：只要该轮剧情涉及表格数据变化就必须写出对应表格语句，禁止为满足纪要要求省略表格变更；只有确认所有表均无变化时才允许只写纪要'
                : 'table 模式某轮无变更时该元素 sql 留空字符串 ""；chronicle 模式每个元素 sql 必须包含对纪要表的 INSERT'
    const feedback = `${SQL_ERROR_MARKER_OPEN}上次输出存在错误，请根据以下信息修正后重新输出完整的 JSON。

错误信息：${lastError}

修正要求：
1. 检查 SQL 语法是否正确
2. 确认表名、列名与 DDL 完全一致（英文物理名）
3. UPDATE/DELETE 必须带 WHERE 条件
4. 字符串值用单引号包裹，内部单引号用两个单引号转义
5. 输出单个 JSON 对象 {"format":"...","items":[{"sql":"..."},...]}，items 数组长度为<正文数据>轮数（每轮一个元素、按楼层顺序），禁止合并多轮
6. ${rule6}；不要输出其他内容${SQL_ERROR_MARKER_CLOSE}`
    return [
        ...baseMessages,
        { role: 'assistant', content: lastRaw },
        { role: 'user', content: feedback },
    ]
}
