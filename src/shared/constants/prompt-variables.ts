import type { PromptSceneKey } from '@shared/types/config'

export interface PromptVariable {
  name: string
  desc: string
}

export interface PromptSceneVariableGroup {
  label: string
  variables: PromptVariable[]
}

export const PROMPT_VARIABLES: Record<PromptSceneKey, PromptSceneVariableGroup> = {
  tableEdit: {
    label: '表格更新',
    variables: [
      {
        name: 'format',
        desc: 'SQL 编辑输出格式标识（当前值 table_edit_sql_v1）。AI 须据此输出 {"format":"...","sql":"..."} 的 JSON。'
      },
      {
        name: 'timeFormat',
        desc: '时间格式说明（ISO 8601，如 YYYY-MM-DDTHH:MM）。告知 AI 纪要表时间列的填写格式。'
      },
      {
        name: 'tables',
        desc: '当前数据库全部普通表的结构与数据。含每张表的 DDL 建表语句、表说明(Note)、列说明、INSERT/UPDATE/DELETE 提示、以及当前数据(JSON)。填表 AI 最核心的上下文。不含纪要表（纪要表由纪要生成场景单独处理）。'
      },
      {
        name: 'worldbook',
        desc: '世界书内容（背景设定）。经关键词扫描激活的世界书条目拼成的文本。'
      },
      {
        name: 'conversation',
        desc: '本轮正文（近期对话文本）。按上下文深度与批处理大小截取，AI 据此执行表格增删改。'
      },
      {
        name: 'persona',
        desc: '用户人设描述（来自酒馆 Persona）。'
      },
      {
        name: 'charDescription',
        desc: '角色设定描述（来自角色卡 description）。'
      }
    ]
  },
  chronicleGen: {
    label: '纪要生成',
    variables: [
      {
        name: 'format',
        desc: 'SQL 编辑输出格式标识（当前值 table_edit_sql_v1）。AI 须据此输出 {"format":"...","sql":"..."} 的 JSON。与表格更新共享。'
      },
      {
        name: 'timeFormat',
        desc: '时间格式说明（ISO 8601，如 YYYY-MM-DDTHH:MM）。告知 AI 纪要表时间列的填写格式。与表格更新共享。'
      },
      {
        name: 'chronicleTable',
        desc: '纪要表的 DDL 建表语句、表说明(Note)、列说明、INSERT/UPDATE/DELETE 提示、以及当前数据（最近 N 条已有纪要）。纪要生成 AI 最核心的上下文。'
      },
      {
        name: 'worldbook',
        desc: '世界书内容（背景设定）。经关键词扫描激活的世界书条目拼成的文本。与表格更新共享。'
      },
      {
        name: 'conversation',
        desc: '本轮正文（近期对话文本）。按上下文深度与批处理大小截取，AI 据此生成纪要记录。与表格更新共享。'
      },
      {
        name: 'persona',
        desc: '用户人设描述（来自酒馆 Persona）。与表格更新共享。'
      },
      {
        name: 'charDescription',
        desc: '角色设定描述（来自角色卡 description）。与表格更新共享。'
      }
    ]
  },
  chronicleRecall: {
    label: '纪要召回',
    variables: [
      {
        name: 'keyExample',
        desc: '纪要编码示例（如 CN0001）。示意 AI 应返回的 keys 编码格式。'
      },
      {
        name: 'chronicleList',
        desc: '纪要列表。JSON 数组，每项含 key(编码)、summary(正文)、storyTime(故事时间)。'
      },
      {
        name: 'userInput',
        desc: '玩家本轮输入。AI 据此从纪要列表中筛选相关条目。'
      }
    ]
  }
}
