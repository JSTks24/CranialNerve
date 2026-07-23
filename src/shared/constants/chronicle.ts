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
      note: 'CN 编码，格式 CNXXXX（4位零填充递增），纪要唯一标识，召回时作关键词'
    },
    {
      name: 'time_start',
      displayName: '起始时间',
      type: 'TEXT',
      constraints: { nullable: false },
      note: '事件起始时间，格式见提示词中的时间格式说明。召回算"距今跨度"和"相对今天"用此列'
    },
    {
      name: 'time_end',
      displayName: '结束时间',
      type: 'TEXT',
      note: '事件结束时间，格式同 time_start。未来可算事件持续时长（end-start）'
    },
    {
      name: 'location',
      displayName: '地点',
      type: 'TEXT',
      constraints: { nullable: false },
      note: '本轮事件发生地点，从大到小描述'
    },
    {
      name: 'chronicle_text',
      displayName: '纪要正文',
      type: 'TEXT',
      constraints: { nullable: false },
      note: '以第三方视角客观记录本轮事件，不得加入推测、情绪化语言或主观判断，不少于300字，结尾禁止总结升华'
    },
    {
      name: 'key_dialogue',
      displayName: '重要台词',
      type: 'TEXT',
      note: '本轮重要台词记录'
    }
  ],
  note: '纪要表：每轮交互后插入一条新记录。禁止 UPDATE/DELETE（纪要只追加不改）。',
  insertHint:
    '每轮交互结束后插入一条新记录。key 用 CNXXXX（递增），time_start/time_end 格式见上方时间格式说明。\n' +
    'SQL示例: INSERT INTO cn_chronicle (key, time_start, time_end, location, chronicle_text, key_dialogue) ' +
    "VALUES ('CN0001', '2024-06-15T23:50', '2024-06-15T23:55', '王城·中央广场', '纪要正文...', '重要台词');",
  updateHint: '禁止 UPDATE。',
  deleteHint: '禁止 DELETE。'
}
