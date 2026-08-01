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
})
