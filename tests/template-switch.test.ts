import { describe, expect, it, vi } from 'vitest'
import { CranialNerveSession } from '../src/core/session'
import SqliteSyncBridge from '../src/db/sqlite/sync-bridge'
import type { CardTemplate } from '../src/shared/types/card'

const mocks = vi.hoisted(() => {
  const chatState: Array<Record<string, unknown>> = []
  const chatMeta: Record<string, unknown> = {}
  const fsSave = vi.fn(async () => {})
  return { chatState, chatMeta, fsSave }
})

vi.mock('@db/gateways/host-context', () => ({
  getHostContext: () => ({
    chat: mocks.chatState,
    chatMetadata: mocks.chatMeta,
    characters: {},
    characterId: null,
    chatId: 'test-chat',
    extensionSettings: {},
    saveSettingsDebounced: () => {},
  }),
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

describe('reinitWithTemplate 数据判定', () => {
  it('无数据聊天干净切换：不备份、不绑定、不写帧、重建表结构', async () => {
    const session = await makeSession()
    mocks.chatState.length = 0
    mocks.chatMeta['CN_TEMPLATE'] = undefined
    mocks.fsSave.mockClear()
    await session.reinitWithTemplate(makeTemplate('hero'), 'tplA')
    expect(mocks.chatMeta['CN_TEMPLATE']).toBeUndefined()
    expect(session.getSyncBridgeRepo()!.findLatestFrameMessageId()).toBeNull()
    expect(mocks.fsSave).not.toHaveBeenCalled()
    expect(session.core.listTables()).toContain('hero')
  })

  it('有数据聊天完整迁移：备份、绑定、写帧、数据保留', async () => {
    const session = await makeSession()
    mocks.chatState.length = 0
    mocks.chatMeta['CN_TEMPLATE'] = undefined
    mocks.fsSave.mockClear()
    const core = session.core
    core.run('CREATE TABLE hero (c TEXT)')
    core.run("INSERT INTO hero VALUES ('old')")
    core.run('CREATE TABLE cn_chronicle (key TEXT, chronicle_text TEXT)')
    mocks.chatState.push({ is_user: true, mes: 'hi' })
    ;(session as unknown as { template: unknown }).template = makeTemplate('hero')
    await session.reinitWithTemplate(makeTemplate('hero'), 'tplA', { migrate: true })
    expect(mocks.chatMeta['CN_TEMPLATE']).toBeTruthy()
    expect(session.getSyncBridgeRepo()!.findLatestFrameMessageId()).not.toBeNull()
    expect(mocks.fsSave).toHaveBeenCalled()
    const rows = core.exec('SELECT * FROM hero')
    expect(rows[0]!.rows[0]!.c).toBe('old')
  })

  it('仅纪要数据视为无数据：干净切换（纪要不受模板切换影响）', async () => {
    const session = await makeSession()
    mocks.chatState.length = 0
    mocks.chatMeta['CN_TEMPLATE'] = undefined
    mocks.fsSave.mockClear()
    const core = session.core
    core.run('CREATE TABLE cn_chronicle (key TEXT, chronicle_text TEXT)')
    core.run("INSERT INTO cn_chronicle VALUES ('CN0001', 'x')")
    await session.reinitWithTemplate(makeTemplate('hero'), 'tplA')
    expect(mocks.chatMeta['CN_TEMPLATE']).toBeUndefined()
    expect(session.getSyncBridgeRepo()!.findLatestFrameMessageId()).toBeNull()
    expect(mocks.fsSave).not.toHaveBeenCalled()
  })
})
