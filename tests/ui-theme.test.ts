import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

function readProjectFile(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf-8')
}

const theme = readProjectFile('src/ui/theme.css')
const welcomePage = readProjectFile('src/ui/pages/Welcome.vue')
const appShell = readProjectFile('src/ui/App.vue')
const strategyPage = readProjectFile('src/ui/pages/Strategy.vue')
const routerSource = readProjectFile('src/ui/router.ts')
const toastSource = readProjectFile('src/ui/toast.ts')
const promptConfigPage = readProjectFile('src/ui/pages/PromptConfig.vue')
const dialogSource = readProjectFile('src/ui/dialog.ts')
const varHelpModal = readProjectFile('src/ui/components/VariableHelpModal.vue')
const tableTypes = readProjectFile('src/shared/types/table.ts')
const sessionSource = readProjectFile('src/core/session.ts')
const blockEditor = readProjectFile('src/ui/components/PromptBlockEditor.vue')
const manualFillPage = readProjectFile('src/ui/pages/ManualFill.vue')
const fillOrchestratorSrc = readProjectFile('src/core/table/fill-orchestrator.ts')

describe('UI 主题守卫（深翠框景）', () => {
  it('必备设计 token 存在', () => {
    const tokens = [
      '--cn-grad-primary',
      '--cn-ink',
      '--cn-ink-text',
      '--cn-primary-mist',
      '--cn-primary-soft',
      '--cn-primary-bright',
      '--cn-primary-deep',
      '--cn-danger',
      '--cn-warn',
      '--cn-surface-3',
      '--cn-radius-lg',
      '--cn-shadow-pill',
      '--cn-ease-pill',
      '--cn-font-mono'
    ]
    for (const token of tokens) expect(theme, `缺少 token ${token}`).toContain(token)
  })

  it('翠玉主色值精确', () => {
    expect(theme).toMatch(/--cn-primary:\s*#128252\b/)
    expect(theme).toMatch(/--cn-grad-primary:\s*linear-gradient\(135deg, #30b57a 0%, #15955f 50%, #0f7a4d 100%\)/)
  })

  it('禁纯黑与黑阴影', () => {
    expect(theme).not.toMatch(/#000000/i)
    expect(theme).not.toMatch(/rgba\(0,\s*0,\s*0/)
  })

  it('禁外引字体', () => {
    expect(theme).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import|@font-face/)
  })

  it('禁 max-height/height 过渡', () => {
    expect(theme).not.toMatch(/transition:\s*[^;}]*max-height/)
  })

  it('无 Material 默认绿/旧语义色残留', () => {
    expect(theme).not.toMatch(/#4caf50|#388e3c|#2e7d32|#e0f2e4|76,\s*175,\s*80|#ff4d4f|#ef4444|#faad14|#fa8c16/)
    expect(toastSource).not.toMatch(/#52c41a|#1677ff|#ff4d4f|#faad14|rgba\(0,\s*0,\s*0/)
  })

  it('首页新版类名已入 theme.css', () => {
    const classes = ['.welcome-hero', '.welcome-stats', '.welcome-stat__num', '.welcome-panels', '.welcome-step', '.welcome-badge', '.welcome-health-item']
    for (const cls of classes) expect(theme, `缺少样式 ${cls}`).toContain(cls)
  })

  it('首页模板使用新版类名', () => {
    const classes = ['welcome-hero', 'welcome-stats', 'welcome-step', 'welcome-panels', 'welcome-badge']
    for (const cls of classes) expect(welcomePage, `模板缺少 ${cls}`).toContain(cls)
  })

  it('.vue 文件禁硬编码色值', () => {
    const files: ReadonlyArray<readonly [string, string]> = [
      ['Welcome.vue', welcomePage],
      ['App.vue', appShell],
      ['Strategy.vue', strategyPage]
    ]
    for (const [name, src] of files) {
      expect(src, `${name} 存在硬编码色值`).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/)
    }
  })

  it('运行策略页已收编待定配置', () => {
    expect(routerSource).toContain("path: '/strategy'")
    expect(routerSource).toContain("import Strategy from './pages/Strategy.vue'")
    expect(routerSource).not.toContain('PendingConfig')
    expect(appShell).not.toContain('待定配置')
    expect(strategyPage).toContain('strategy-row')
  })

  it('运行策略与菜单分组样式已入 theme.css', () => {
    const classes = ['.cn-tabs', '.cn-tabs__indicator', '.cn-tabs__item--active', '.strategy-row', '.strategy-num', '.strategy-warn', '.cn-menu__section']
    for (const cls of classes) expect(theme, `缺少样式 ${cls}`).toContain(cls)
  })

  it('CNTabs 滑块组件含滑动指示片', () => {
    const tabsComp = readProjectFile('src/ui/components/CNTabs.vue')
    expect(tabsComp).toContain('--tab-x')
    expect(tabsComp).toContain('ResizeObserver')
    expect(theme).toContain('--tab-x')
    expect(theme).toContain('--tab-w')
    expect(theme).toContain('translateX(var(--tab-x))')
  })

  it('禁 left/top 过渡（动效铁律）', () => {
    expect(theme).not.toMatch(/transition:\s*[^;}]*\bleft\b/)
    expect(theme).not.toMatch(/transition:\s*[^;}]*\btop\b/)
  })

  it('表格表头用 surface-2 弱字底', () => {
    expect(theme).toMatch(/\.cn-table th \{[\s\S]*?background:\s*var\(--cn-surface-2\)/)
  })

  it('首页统计带非三等分', () => {
    expect(theme).not.toContain('repeat(3, minmax(0, 1fr))')
  })

  it('变量说明弹窗类名已入 theme.css', () => {
    const classes = ['.cn-modal--md', '.cn-modal__body', '.var-card', '.var-card__tag', '.var-card__desc']
    for (const cls of classes) expect(theme, `缺少样式 ${cls}`).toContain(cls)
  })

  it('提示词配置页接入变量说明弹窗', () => {
    expect(promptConfigPage).toContain('VariableHelpModal')
    expect(promptConfigPage).toContain('varHelpVisible')
    expect(promptConfigPage).toContain('可用变量')
  })

  it('预设列表用普通 ul 无进场动画', () => {
    expect(promptConfigPage).toContain('<ul class="preset-list">')
  })

  it('VariableHelpModal 禁硬编码色值', () => {
    expect(varHelpModal).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/)
  })

  it('世界书注入行控件等高对齐 + 固定宽靠左 + 显隐宽度过渡', () => {
    expect(promptConfigPage).toContain('tpl-row--inject')
    expect(promptConfigPage).toContain('align-items: flex-start')
    expect(promptConfigPage).not.toContain('justify-content: space-between')
    expect(promptConfigPage).not.toContain('flex: 1 1 120px')
    expect(promptConfigPage).toContain("'tpl-field--hidden'")
    expect(theme).toContain('.tpl-field--hidden')
    expect(theme).toMatch(/\.tpl-field \{[\s\S]*?transition:\s*max-width/)
    expect(promptConfigPage).toContain('<button class="cn-btn" @click="openKeywordPromptEditor(table)">')
    expect(promptConfigPage).toContain('class="cn-switch" style="height: 32px')
  })

  it('关键词提示词弹窗脱离 !showTemplate 分支（顶层渲染）', () => {
    const previewIdx = promptConfigPage.indexOf('v-if="previewTemplateVisible"')
    const modalIdx = promptConfigPage.indexOf('v-if="keywordPromptEditing"')
    const lastNotTplIdx = promptConfigPage.lastIndexOf('<template v-if="!showTemplate">')
    expect(modalIdx, '关键词弹窗存在').toBeGreaterThan(-1)
    expect(modalIdx, '关键词弹窗应在 previewTemplate 弹窗之后').toBeGreaterThan(previewIdx)
    expect(modalIdx, '关键词弹窗应在最后一个 !showTemplate 块之前（顶层）').toBeLessThan(lastNotTplIdx)
  })

  it('cn-select 强制 margin:0 覆盖酒馆全局 select margin（控件中线对齐）', () => {
    expect(theme).toMatch(/\.cn-select \{[\s\S]*?margin:\s*0\s*!important/)
  })

  it('keywordAiPrompt 类型为 PromptSegment[]（支持块级编辑）', () => {
    expect(tableTypes).toMatch(/keywordAiPrompt\?:\s*PromptSegment\[\]/)
  })

  it('PromptBlockEditor 组件存在且被预设与关键词编辑复用', () => {
    expect(blockEditor).toContain('PromptSegmentEditor')
    expect(blockEditor).toContain('draggable')
    expect(promptConfigPage).toContain('PromptBlockEditor')
    expect(promptConfigPage).toMatch(/v-model="activePreset\.segments"/)
    expect(promptConfigPage).toMatch(/v-model="keywordPromptDraft"/)
  })

  it('关键词提示词弹窗用块级编辑 + 预览切换', () => {
    expect(promptConfigPage).toContain('keywordPreviewMode')
    expect(promptConfigPage).toContain('openKeywordPreview')
  })

  it('后端 generateKeywordsForRows 用 keywordAiPrompt segments 拼 messages', () => {
    expect(sessionSource).toContain('aiSegments')
    expect(sessionSource).toContain('role: s.role, content: s.content')
    expect(sessionSource).not.toContain("role: 'system', content: aiPrompt")
  })

  it('新建来源弹窗类名已入 theme.css', () => {
    const classes = [
      '.cn-modal-option',
      '.cn-modal-option__label',
      '.cn-modal-option__desc',
      '.cn-modal-option__hint',
      '.cn-modal-option--disabled'
    ]
    for (const cls of classes) expect(theme, `缺少样式 ${cls}`).toContain(cls)
  })

  it('提示词配置页接入新建来源弹窗', () => {
    expect(promptConfigPage).toContain('PresetSourceModal')
    expect(promptConfigPage).toContain('newPresetVisible')
    expect(promptConfigPage).toContain('newPresetTVisible')
    expect(promptConfigPage).toContain('handleNewPreset')
    expect(promptConfigPage).toContain('handleNewPresetT')
  })

  it('PresetSourceModal 禁硬编码色值', () => {
    const presetSourceModal = readProjectFile('src/ui/components/PresetSourceModal.vue')
    expect(presetSourceModal).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/)
  })

  it('纪要表恢复默认按钮与逻辑已接入', () => {
    expect(promptConfigPage).toContain('resetChronicleTableDef')
    expect(promptConfigPage).toContain('恢复默认')
    expect(sessionSource).toContain('getDefaultChronicleTable(): TableDef | null')
    expect(sessionSource).toContain('getGatewayDefaultChronicleTable')
  })

  it('纪要索引不再显示七字段提示', () => {
    const chroniclePage = readProjectFile('src/ui/pages/Chronicle.vue')
    expect(chroniclePage).not.toContain('七字段')
    expect(chroniclePage).not.toContain('IMPORTANT_WORD_FIELDS')
    expect(theme).not.toContain('.chronicle-field__hint')
  })

  it('手动填表/纪要 contextDepth 文案改为处理最近N个AI楼层', () => {
    const manualFillPage = readProjectFile('src/ui/pages/ManualFill.vue')
    const chroniclePage = readProjectFile('src/ui/pages/Chronicle.vue')
    const cases: ReadonlyArray<readonly [string, string]> = [['ManualFill', manualFillPage], ['Chronicle', chroniclePage]]
    for (const [name, src] of cases) {
      expect(src, `${name} 应含新文案`).toContain('处理最近 N 个 AI 楼层')
      expect(src, `${name} 应含新 hint`).toContain('处理最近多少个 AI 楼层')
      expect(src, `${name} 不应含旧文案`).not.toContain('参考最近 N 轮对话')
      expect(src, `${name} 不应含条对话文案`).not.toContain('处理最近 N 条对话')
    }
  })

  it('调试模式开关移入运行日志工具栏最右侧', () => {
    const debugPage = readProjectFile('src/ui/pages/Debug.vue')
    expect(debugPage).not.toContain('debug-mode-row')
    expect(debugPage).not.toContain('开启后采集 debug 日志与 AI 提示词')
    expect(debugPage).toContain('debug-toolbar__debug')
    expect(debugPage).toContain('调试模式')
    expect(theme).not.toContain('.debug-mode-row')
    expect(theme).toContain('.debug-toolbar__debug')
  })

  it('batchSize 标签改为每批处理 N 个 AI 楼层', () => {
    const manualFillPage = readProjectFile('src/ui/pages/ManualFill.vue')
    const chroniclePage = readProjectFile('src/ui/pages/Chronicle.vue')
    expect(manualFillPage).toContain('每批处理 N 个 AI 楼层')
    expect(chroniclePage).toContain('每批处理 N 个 AI 楼层')
    const cases: ReadonlyArray<readonly [string, string]> = [['ManualFill', manualFillPage], ['Chronicle', chroniclePage]]
    for (const [name, src] of cases) {
      expect(src, `${name} 不应含旧 batchSize 标签`).not.toContain('一次处理 N 条消息')
    }
  })

  it('merged 双向转圈：两页接入 fillStatusStore 与转圈图标', () => {
    const manualFillPage = readProjectFile('src/ui/pages/ManualFill.vue')
    const chroniclePage = readProjectFile('src/ui/pages/Chronicle.vue')
    expect(manualFillPage).toContain('useFillStatusStore')
    expect(manualFillPage).toContain('tableBusy')
    expect(manualFillPage).toContain('fa-spinner fa-spin')
    expect(chroniclePage).toContain('useFillStatusStore')
    expect(chroniclePage).toContain('chronicleBusy')
    expect(chroniclePage).toContain('fa-spinner fa-spin')
    expect(readProjectFile('src/ui/stores/fill-status.ts')).toContain('subscribeFillState')
  })

  it('手动填表更新状态用词改为更新且含每表更新列，纪要去掉同时更新表格', () => {
    const manualFillPage = readProjectFile('src/ui/pages/ManualFill.vue')
    const chroniclePage = readProjectFile('src/ui/pages/Chronicle.vue')
    expect(manualFillPage).toContain('已更新')
    expect(manualFillPage).toContain('未更新')
    expect(manualFillPage).toContain('待更新')
    expect(manualFillPage).toContain('更新至')
    expect(manualFillPage).not.toContain('已总结')
    expect(manualFillPage).not.toContain('未总结')
    expect(manualFillPage).not.toContain('待总结')
    expect(chroniclePage).not.toContain('同时更新表格')
    expect(chroniclePage).not.toContain('includeTables')
  })

  it('AI 调用超时 0=永不超时，默认 0', () => {
    const strategyPage = readProjectFile('src/ui/pages/Strategy.vue')
    expect(strategyPage).toContain('0=永不超时')
    expect(strategyPage).toContain('aiTimeoutText')
    expect(strategyPage).toContain('∞')
    expect(strategyPage).not.toContain('0=永不超时（显示∞）')
    expect(strategyPage).not.toContain('默认 60000')
  })
})

describe('模板与提示词预设弹窗改名', () => {
  it('dialog.ts 提供带输入框的改名弹窗', () => {
    expect(dialogSource).toContain('promptRename')
    expect(dialogSource).toContain('cn-dlg-input')
    expect(dialogSource).toContain('input.focus()')
    expect(dialogSource).toContain('input.select()')
    expect(dialogSource).toContain("e.key === 'Enter'")
  })

  it('模板预设与提示词预设均有弹窗改名入口（编辑器头部）', () => {
    expect(promptConfigPage).toContain('renamePresetT')
    expect(promptConfigPage).toContain('renamePreset')
    expect(promptConfigPage).toContain('renamePresetT(activeTemplatePreset.id)')
    expect(promptConfigPage).toContain('renamePreset(activePreset.id)')
    expect(promptConfigPage).toContain('fa-pen')
    expect(promptConfigPage).toContain('prompt-editor__title-group')
  })

  it('角色卡来源预设不显示删除按钮，模板复制功能已移除', () => {
    expect(promptConfigPage).toContain(`v-if="p.source !== 'card'"`)
    expect(promptConfigPage).toContain('title="删除"')
    expect(promptConfigPage).not.toContain('duplicatePresetT')
    expect(promptConfigPage).not.toContain('fa-copy')
  })

  it('预设列表点击选中、对号浮现才切换，按钮常驻透明占位', () => {
    expect(promptConfigPage).toContain('selectedPresetId')
    expect(promptConfigPage).toContain('selectedScenePresetId')
    expect(promptConfigPage).toContain('selectPresetItem')
    expect(promptConfigPage).toContain('preset-list__item--selected')
    expect(promptConfigPage).toContain('@click="selectPresetItem(p.id)"')
    expect(promptConfigPage).toContain('preset-list__actions')
    expect(promptConfigPage).toContain('preset-list__btn-hidden')
    expect(promptConfigPage).toContain(
      'selectedPresetId !== p.id || p.id === ttConfig.activeId'
    )
    expect(theme).toContain('.preset-list__item--selected')
  })

  it('预设列表固定行高 46px，选中/未选中高度一致', () => {
    expect(theme).toMatch(/\.preset-list__item \{[^}]*height:\s*46px;/)
    expect(theme).not.toMatch(/\.preset-list__item \{[^}]*min-height/)
    expect(theme).toContain('.preset-list__actions .cn-btn.preset-list__btn-hidden')
  })

  it('绑定模板条目布局与样式合规（name-text、无彩色外光环、soft 徽标）', () => {
    expect(theme).toContain('.preset-list__name-text')
    expect(promptConfigPage).toMatch(/preset-list__name-text">本聊天绑定模板<\/span>/)
    expect(theme).not.toMatch(/\.preset-list__item--bound \{[^}]*box-shadow/)
    expect(theme).toMatch(/\.preset-list__badge \{[^}]*background:\s*var\(--cn-primary-soft\)/)
    expect(theme).not.toMatch(/\.preset-list__badge \{[^}]*background:\s*var\(--cn-grad-primary\)/)
  })

  it('解除绑定按钮已删除，无双 toast 文案残留', () => {
    expect(promptConfigPage).not.toContain('unbindBoundPreset')
    expect(promptConfigPage).not.toContain('fa-unlink')
    expect(promptConfigPage).not.toContain('已解除聊天模板绑定')
    expect(sessionSource).not.toContain('已解除聊天模板绑定')
  })

  it('追平范围按每侧游标计算，不再塌缩到第1层', () => {
    expect(manualFillPage).toContain('tableFromSeq')
    expect(manualFillPage).toContain('chronicleFromSeq')
    expect(manualFillPage).not.toMatch(/Math\.min\(t \?\? -1, c \?\? -1\)/)
    expect(fillOrchestratorSrc).not.toMatch(/Math\.min\(t \?\? -1, c \?\? -1\)/)
    expect(fillOrchestratorSrc).toContain('detectMergedLastFilled')
  })

  it('内置模板预设可删除，不再强制恒存在', () => {
    expect(promptConfigPage).not.toContain('内置模板不可删除')
    const configGateway = readProjectFile('src/db/gateways/config.ts')
    expect(configGateway).toContain('cur.presets.length === 0')
  })

  it('纪要表编辑与恢复默认使用响应式 store 源', () => {
    expect(promptConfigPage).toContain(
      'store.config.chronicleTableDef ?? session.getChronicleTableDef()'
    )
  })

  it('纪要表头部说明弹性布局与弹窗输入框样式已入 theme.css', () => {
    expect(theme).toMatch(/\.prompt-editor__desc \{[\s\S]*?flex:\s*1;/)
    expect(theme).toMatch(/\.prompt-editor__desc \{[\s\S]*?min-width:\s*0;/)
    expect(theme).toContain('.prompt-editor__title-group')
    expect(theme).toContain('.cn-dialog__field')
  })
})
