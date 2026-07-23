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
      note: ''
    },
    {
      name: 'time_start',
      displayName: '起始时间',
      type: 'TEXT',
      constraints: { nullable: false },
      note: ''
    },
    {
      name: 'time_end',
      displayName: '结束时间',
      type: 'TEXT',
      note: ''
    },
    {
      name: 'location',
      displayName: '地点',
      type: 'TEXT',
      constraints: { nullable: false },
      note: ''
    },
    {
      name: 'chronicle_text',
      displayName: '纪要正文',
      type: 'TEXT',
      constraints: { nullable: false },
      note: ''
    },
    {
      name: 'key_dialogue',
      displayName: '重要台词',
      type: 'TEXT',
      note: ''
    }
  ],
  note: '',
  insertHint: '',
  updateHint: '',
  deleteHint: ''
}
