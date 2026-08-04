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
const varHelpModal = readProjectFile('src/ui/components/VariableHelpModal.vue')
const tableTypes = readProjectFile('src/shared/types/table.ts')
const sessionSource = readProjectFile('src/core/session.ts')
const blockEditor = readProjectFile('src/ui/components/PromptBlockEditor.vue')

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
})
