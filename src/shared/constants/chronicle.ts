import type { TableDef } from '@shared/types/table'

export const CHRONICLE_TABLE_NAME = 'cn_chronicle'

export const DEFAULT_CHRONICLE_TABLE: TableDef = {
  name: CHRONICLE_TABLE_NAME,
  displayName: '纪要表',
  columns: [
    {
      name: 'key',
      displayName: '编码',
      type: 'TEXT',
      constraints: { primaryKey: true, unique: true, nullable: false },
      note: 'CN 编码，格式 CNXXXX（4位零填充递增），纪要唯一标识，作召回关键词',
      role: 'key'
    },
    {
      name: 'time_start',
      displayName: '起始时间',
      type: 'TEXT',
      constraints: { nullable: false },
      note: '事件起始时间，ISO 8601（YYYY-MM-DDTHH:MM）。召回算时间跨度用此列',
      role: 'timeStart'
    },
    {
      name: 'time_end',
      displayName: '结束时间',
      type: 'TEXT',
      note: '事件结束时间，格式同 time_start。可算事件持续时长',
      role: 'timeEnd'
    },
    {
      name: 'location',
      displayName: '地点',
      type: 'TEXT',
      constraints: { nullable: false },
      note: '本轮事件发生地点，从大到小描述',
      role: 'location'
    },
    {
      name: 'chronicle_text',
      displayName: '纪要正文',
      type: 'TEXT',
      constraints: { nullable: false },
      note: '第三方视角客观记录，不含推测/情绪/主观判断，忠于原文不补充，不少于300字，结尾禁止总结升华',
      role: 'summary'
    },
    {
      name: 'key_dialogue',
      displayName: '重要台词',
      type: 'TEXT',
      note: '本轮最重要的台词（1-3句），保留原文。无重要台词则留空',
      role: 'keyDialogue'
    }
  ],
  note: '纪要表，每轮交互后必须立即插入一条新记录，禁止 UPDATE/DELETE（纪要只追加不改写）。第三方视角客观记录，作召回记忆源。',
  insertHint: '每轮交互后必须 INSERT 一条新记录。\nkey 用 CNXXXX 递增（查现有最大序号+1）。\ntime_start/time_end 用正文明确时间或合理推算，只提取时间点本身，不要计算时间差。\nchronicle_text 用第三方视角（角色名称指代，不用"你"或"我"），客观记录（禁"令人感动"等主观评价），忠于原文（不补充未出现情节），不少于300字，结尾禁止总结升华。\nSQL示例: INSERT INTO cn_chronicle (key, time_start, time_end, location, chronicle_text, key_dialogue) VALUES (\'CN0001\', \'2024-03-15T14:00\', \'2024-03-15T15:00\', \'王城·中央广场\', \'本轮纪要内容...\', \'重要台词\');',
  updateHint: '禁止 UPDATE 纪要表。纪要只追加不改写。',
  deleteHint: '禁止 DELETE 纪要表记录。'
}
