import { describe, expect, it, vi } from 'vitest'
import { CranialNerveSession } from '../src/core/session'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
import type { CardTemplate } from '../src/shared/types/card'

const mocks = vi.hoisted(() => {
  const chatState: Array<Record<string, unknown>> = []
  const chatMeta: Record<string, unknown> = {}
  const fsSave = vi.fn(async () => {})
  const host = {
    chat: chatState,
    chatMetadata: chatMeta,
    characters: {},
    characterId: null,
    chatId: 'test-chat',
    extensionSettings: {},
    saveSettingsDebounced: () => {},
  }
  return { chatState, chatMeta, fsSave, host }
})

vi.mock('@db/gateways/host-context', () => ({
  getHostContext: () => mocks.host,
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
}))

vi.mock('@db/gateways/host-state', () => ({
  getPersonaDescription: () => '',
  getCharDescription: () => '',
  getUserName: () => 'User',
}))

vi.mock('@db/gateways/file-storage', () => ({
  default: () => ({
    save: mocks.fsSave,
    read: async () => null,
    delete: async () => {},
  }),
}))

function makeTemplate(name: string): CardTemplate {
  return {
    templateVersion: 1,
    tables: [
      { name, displayName: name, columns: [{ name: 'c', displayName: 'c', type: 'TEXT' }], enabled: true },
    ],
  }
}

async function makeSession(): Promise<CranialNerveSession> {
  const session = new CranialNerveSession()
  const core = (session as unknown as { core: import('../src/db/sqlite/core').default }).core
  await core.init()
  const chat = (session as unknown as { chat: import('../src/db/gateways/chat').ChatGateway }).chat
  ;(session as unknown as { syncBridge: unknown }).syncBridge = new SqliteSyncBridge(core, chat)
  ;(session as unknown as { getChronicleTableDef: () => unknown }).getChronicleTableDef = () => ({
    name: 'cn_chronicle',
    displayName: '纪要表',
    columns: [{ name: 'key', displayName: '编码', type: 'TEXT' }],
  })
  return session
}

describe('reinitWithTemplate 切换语义：清表格、留纪要、无条件绑定', () => {
  it('无数据聊天切换：无条件绑定 + 写帧 + 重建表结构', async () => {
    const session = await makeSession()
    mocks.chatState.length = 0
    mocks.chatMeta['CN_TEMPLATE'] = undefined
    mocks.chatMeta['CN_TEMPLATE_ID'] = undefined
    mocks.fsSave.mockClear()
    await session.reinitWithTemplate(makeTemplate('hero'), 'tplA')
    expect(mocks.chatMeta['CN_TEMPLATE']).toBeTruthy()
    expect(mocks.chatMeta['CN_TEMPLATE_ID']).toBe('tplA')
    expect(session.getBoundTemplateId()).toBe('tplA')
    expect(mocks.fsSave).not.toHaveBeenCalled()
    expect(session.core.listTables()).toContain('hero')
  })

  it('有数据聊天切换：表格数据清空、纪要保留、绑定新模板、写帧', async () => {
    const session = await makeSession()
    mocks.chatState.length = 0
    mocks.chatMeta['CN_TEMPLATE'] = undefined
    mocks.chatMeta['CN_TEMPLATE_ID'] = undefined
    mocks.fsSave.mockClear()
    const core = session.core
    core.run('CREATE TABLE hero (c TEXT)')
    core.run("INSERT INTO hero VALUES ('old')")
    core.run('CREATE TABLE cn_chronicle (key TEXT, chronicle_text TEXT)')
    core.run("INSERT INTO cn_chronicle VALUES ('CN0001', 'x')")
    mocks.chatState.push({ is_user: true, mes: 'hi' })
    ;(session as unknown as { template: unknown }).template = makeTemplate('hero')
    await session.reinitWithTemplate(makeTemplate('tplB'), 'tplA')
    expect(mocks.chatMeta['CN_TEMPLATE']).toBeTruthy()
    expect(mocks.chatMeta['CN_TEMPLATE_ID']).toBe('tplA')
    expect(session.getSyncBridgeRepo()!.findLatestFrameMessageId()).not.toBeNull()
    expect(mocks.fsSave).not.toHaveBeenCalled()
    const tplCount = core.exec('SELECT COUNT(*) AS c FROM tplB')[0]?.rows[0]?.c ?? 0
    expect(tplCount).toBe(0)
    const chronicleRows = core.exec('SELECT * FROM cn_chronicle')
    expect(chronicleRows[0]!.rows).toHaveLength(1)
  })

  it('仅纪要数据切换：纪要保留 + 绑定新模板', async () => {
    const session = await makeSession()
    mocks.chatState.length = 0
    mocks.chatMeta['CN_TEMPLATE'] = undefined
    mocks.chatMeta['CN_TEMPLATE_ID'] = undefined
    mocks.fsSave.mockClear()
    const core = session.core
    core.run('CREATE TABLE cn_chronicle (key TEXT, chronicle_text TEXT)')
    core.run("INSERT INTO cn_chronicle VALUES ('CN0001', 'x')")
    await session.reinitWithTemplate(makeTemplate('hero'), 'tplA')
    expect(mocks.chatMeta['CN_TEMPLATE']).toBeTruthy()
    expect(mocks.chatMeta['CN_TEMPLATE_ID']).toBe('tplA')
    expect(mocks.fsSave).not.toHaveBeenCalled()
    const chronicleRows = core.exec('SELECT * FROM cn_chronicle')
    expect(chronicleRows[0]!.rows).toHaveLength(1)
  })

  it('initSessionTemplate：CN_TEMPLATE_ID 命中预设时 currentTemplateId=预设 id', async () => {
    const session = await makeSession()
    mocks.chatState.length = 0
    mocks.chatMeta['CN_TEMPLATE'] = JSON.parse(JSON.stringify(makeTemplate('hero')))
    mocks.chatMeta['CN_TEMPLATE_ID'] = 'tplA'
    const cfg = session.getConfig()
    cfg.tableTemplate.presets = [{ id: 'tplA', name: 'A', template: makeTemplate('hero'), source: 'builtin' }]
    session.saveConfig(cfg)
    ;(session as unknown as { initSessionTemplate: () => void }).initSessionTemplate()
    expect(session.getCurrentTemplateId()).toBe('tplA')
  })

  it('ensureBoundTemplate：表已有数据不固化，空表才固化', async () => {
    const session = await makeSession()
    mocks.chatState.length = 0
    mocks.chatMeta['CN_TEMPLATE'] = undefined
    mocks.chatMeta['CN_TEMPLATE_ID'] = undefined
    const core = session.core
    ;(session as unknown as { template: unknown }).template = makeTemplate('hero')
    core.run('CREATE TABLE hero (c TEXT)')
    core.run("INSERT INTO hero VALUES ('x')")
    session.ensureBoundTemplate()
    expect(mocks.chatMeta['CN_TEMPLATE']).toBeUndefined()
    core.run('DELETE FROM hero')
    session.ensureBoundTemplate()
    expect(mocks.chatMeta['CN_TEMPLATE']).toBeTruthy()
  })
})
