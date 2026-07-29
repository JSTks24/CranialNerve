import type { CardTemplate } from '../types/card'
import type { TableTemplatePreset } from '../types/config'

export const DEFAULT_TEMPLATE_PRESET_ID = '__default__'

export const DEFAULT_TABLE_TEMPLATE: CardTemplate = {
  templateVersion: 1,
  tables: [
    {
      name: 'protagonist_info',
      displayName: '主角信息表',
      columns: [
        {
          name: 'char_name',
          displayName: '人物名称',
          type: 'TEXT',
          constraints: { primaryKey: true, nullable: false },
          note: '主角的名字'
        },
        { name: 'gender_age', displayName: '性别/年龄', type: 'TEXT', note: '主角的生理性别和年龄' },
        { name: 'appearance', displayName: '外貌特征', type: 'TEXT', note: '对主角外貌的客观文字描写' },
        { name: 'occupation', displayName: '职业/身份', type: 'TEXT', note: '主角在社会中的主要角色' },
        {
          name: 'past_experience',
          displayName: '过往经历',
          type: 'TEXT',
          note: '主角背景故事与关键经历，随剧情增量更新，不超过300字，超过时压缩'
        },
        { name: 'personality', displayName: '性格特点', type: 'TEXT', note: '主角核心性格概括' }
      ],
      note: '记录主角的核心身份信息。此表有且仅有一行，初始化时插入，之后仅 UPDATE，禁止 INSERT/DELETE。',
      insertHint:
        '禁止 INSERT。仅在游戏初始化时插入主角的唯一一行。\nSQL示例: INSERT INTO protagonist_info (char_name, gender_age, appearance, occupation, past_experience, personality) VALUES (\'主角名\', \'男/20\', \'外貌\', \'职业\', \'经历\', \'性格\');',
      updateHint:
        '主角各项状态变化时更新；过往经历列随剧情增量更新，超过300字需压缩。\nSQL示例: UPDATE protagonist_info SET past_experience = \'更新后经历\', occupation = \'新职业\' WHERE char_name = \'主角名\';',
      deleteHint: '禁止 DELETE。',
      exportConfig: { enabled: true, entryType: 'constant', splitByRow: false, keywordColumn: '', keywords: '' }
    },
    {
      name: 'important_characters',
      displayName: '重要角色表',
      columns: [
        {
          name: 'name',
          displayName: '姓名',
          type: 'TEXT',
          constraints: { primaryKey: true, unique: true, nullable: false },
          note: 'NPC 的名字'
        },
        { name: 'gender_age', displayName: '性别/年龄', type: 'TEXT', note: 'NPC 的生理性别和年龄' },
        {
          name: 'brief_intro',
          displayName: '一句话介绍',
          type: 'TEXT',
          note: '不超过15字概括角色身份背景，不含主观评价'
        },
        { name: 'appearance', displayName: '外貌特征', type: 'TEXT', note: 'NPC 外貌和当前衣着描写' },
        { name: 'key_items', displayName: '持有的重要物品', type: 'TEXT', note: '关键物品列表，分号分隔' },
        {
          name: 'is_absent',
          displayName: '是否离场',
          type: 'TEXT',
          constraints: { nullable: false },
          note: '该角色是否能直接与主角互动，填“是”或“否”'
        },
        {
          name: 'past_experience',
          displayName: '过往经历',
          type: 'TEXT',
          note: '角色背景与关键事件，随剧情增量更新，不超过300字，超过时压缩'
        }
      ],
      note: '记录所有关键 NPC 的详细信息与动态状态。每个角色一行。',
      insertHint:
        '剧情中有未记录的重要人物登场时添加。\nSQL示例: INSERT INTO important_characters (name, gender_age, brief_intro, appearance, key_items, is_absent, past_experience) VALUES (\'角色名\', \'女/20\', \'简介\', \'外貌\', \'物品\', \'否\', \'经历\');',
      updateHint:
        '角色状态/关系/经历变化时更新；角色死亡在姓名旁标注（已死亡）。\nSQL示例: UPDATE important_characters SET is_absent = \'是\', past_experience = \'新增经历\' WHERE name = \'角色名\';',
      deleteHint: '禁止 DELETE。',
      exportConfig: { enabled: true, entryType: 'keyword', splitByRow: true, keywordColumn: 'name', keywords: '' }
    },
    {
      name: 'inventory',
      displayName: '背包物品表',
      columns: [
        {
          name: 'item_name',
          displayName: '物品名称',
          type: 'TEXT',
          constraints: { primaryKey: true, unique: true, nullable: false },
          note: '物品的名称'
        },
        {
          name: 'quantity',
          displayName: '数量',
          type: 'INTEGER',
          constraints: { nullable: false },
          note: '拥有的数量，必须大于 0'
        },
        { name: 'description', displayName: '描述/效果', type: 'TEXT', note: '物品的功能或背景描述' },
        { name: 'category', displayName: '类别', type: 'TEXT', note: '如：武器、消耗品、杂物' }
      ],
      note: '记录主角拥有的所有物品、装备。每种物品一行。',
      insertHint:
        '主角获得背包中没有的全新物品时添加。\nSQL示例: INSERT INTO inventory (item_name, quantity, description, category) VALUES (\'新物品\', 1, \'描述\', \'杂物\');',
      updateHint:
        '已有物品数量变化或状态变化时更新。\nSQL示例: UPDATE inventory SET quantity = quantity + 3 WHERE item_name = \'治疗药水\';',
      deleteHint:
        '物品被完全消耗、丢弃或摧毁时删除。\nSQL示例: DELETE FROM inventory WHERE item_name = \'已消耗物品\';',
      exportConfig: { enabled: true, entryType: 'constant', splitByRow: false, keywordColumn: '', keywords: '' }
    },
    {
      name: 'quests_events',
      displayName: '任务与事件表',
      columns: [
        {
          name: 'quest_name',
          displayName: '任务名称',
          type: 'TEXT',
          constraints: { primaryKey: true, unique: true, nullable: false },
          note: '任务的标题'
        },
        { name: 'quest_type', displayName: '任务类型', type: 'TEXT', note: '主线任务或支线任务' },
        { name: 'issuer', displayName: '发布者', type: 'TEXT', note: '发布任务的角色或势力' },
        { name: 'detail_desc', displayName: '详细描述', type: 'TEXT', note: '任务的目标和要求' },
        { name: 'current_progress', displayName: '当前进度', type: 'TEXT', note: '任务完成度的简要描述' },
        { name: 'time_limit', displayName: '任务时限', type: 'TEXT', note: '完成任务的剩余时间' },
        { name: 'reward', displayName: '奖励', type: 'TEXT', note: '完成任务可获得的奖励' },
        { name: 'penalty', displayName: '惩罚', type: 'TEXT', note: '任务失败的后果' }
      ],
      note: '记录所有当前正在进行的任务。每个任务一行。',
      insertHint:
        '主角接取或触发新任务时添加。\nSQL示例: INSERT INTO quests_events (quest_name, quest_type, issuer, detail_desc, current_progress, time_limit, reward, penalty) VALUES (\'新任务\', \'支线任务\', \'村长\', \'描述\', \'刚接取\', \'7天\', \'金币100\', \'声望降低\');',
      updateHint:
        '任务取得关键进展时更新。\nSQL示例: UPDATE quests_events SET current_progress = \'已完成第一阶段\', time_limit = \'剩余3天\' WHERE quest_name = \'拯救公主\';',
      deleteHint:
        '任务完成、失败或过期时删除。\nSQL示例: DELETE FROM quests_events WHERE quest_name = \'已完成的任务\';',
      exportConfig: { enabled: true, entryType: 'constant', splitByRow: false, keywordColumn: '', keywords: '' }
    }
  ]
}

export function createDefaultTemplatePreset(): TableTemplatePreset {
  return {
    id: DEFAULT_TEMPLATE_PRESET_ID,
    name: '默认模板',
    template: JSON.parse(JSON.stringify(DEFAULT_TABLE_TEMPLATE)) as CardTemplate,
    source: 'builtin'
  }
}
