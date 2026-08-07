import { createApp, type App as VueApp } from 'vue'
import { createPinia, type Pinia } from 'pinia'
import themeCss from './theme.css?inline'
import { getSession } from '@core/session'
import { isFillInProgress } from '@core/table/fill-orchestrator'
import toast from './toast'
import { installRecallRenderer } from './recall-card'
import App from './App.vue'
import router from './router'

let themeInjected = false
let appMounted = false
let appInstance: VueApp | null = null
let appPinia: Pinia | null = null
let prevBodyOverflow = ''

export async function init(): Promise<void> {
	await new Promise<void>((resolve) => {
		$(async () => {
			await boot()
			resolve()
		})
	})
}

async function boot(): Promise<void> {
  const session = getSession()
  session.setProgressNotifier(toast.progress)
  session.setToastNotifier(toast)
  const recallRenderer = installRecallRenderer(session)
  session.setRecallCardRenderer((msgId) => recallRenderer.renderFloor(msgId))
  await session.init()
  injectTheme()
  mountDrawer()
  mountWandButton()
  hookSendBlock()
  recallRenderer.rescanAll()
}

function injectTheme(): void {
  if (themeInjected) {
    return
  }
  const style = document.createElement('style')
  style.id = 'cn_theme'
  style.textContent = themeCss
  document.head.appendChild(style)
  themeInjected = true
}

function mountDrawer(): void {
  if (document.getElementById('cn_drawer')) {
    return
  }
  const container = document.getElementById('extensions_settings2')
  if (!container) {
    return
  }
  const drawer = document.createElement('div')
  drawer.id = 'cn_drawer'
  drawer.className = 'inline-drawer'
  drawer.innerHTML = `
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>CranialNerve</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <button id="cn_open_panel" class="menu_button" type="button">打开 CranialNerve 页面</button>
        </div>
    `
  container.append(drawer)
  const toggle = drawer.querySelector('.inline-drawer-toggle') as HTMLElement
  toggle.addEventListener('click', () => {
    drawer.classList.toggle('forceHidden')
  })
  drawer.querySelector('#cn_open_panel')!.addEventListener('click', () => {
    openPanel()
  })
}

function mountWandButton(): void {
  if (document.getElementById('cn_wand_item')) {
    return
  }
  const menu = document.getElementById('extensionsMenu')
  if (!menu) {
    return
  }
  const wrapper = document.createElement('div')
  wrapper.className = 'extension_container interactable'
  wrapper.tabIndex = 0
  const item = document.createElement('div')
  item.id = 'cn_wand_item'
  item.className = 'list-group-item flex-container flexGap5 interactable'
  item.title = '打开 CranialNerve 页面'
  item.innerHTML = `
        <div class="fa-fw fa-solid fa-brain extensionsMenuExtensionButton"></div>
        <span>CranialNerve</span>
    `
  item.addEventListener('click', (e) => {
    e.stopPropagation()
    const btn = document.getElementById('extensionsMenuButton')
    if (btn) {
      ;(btn as HTMLElement).click()
    }
    openPanel()
  })
  wrapper.append(item)
  menu.append(wrapper)
}

let lastSendBlockToastAt = 0

function hookSendBlock(): void {
  const block = (e: Event) => {
    if (isFillInProgress()) {
      e.stopImmediatePropagation()
      e.preventDefault()
      const now = Date.now()
      if (now - lastSendBlockToastAt > 3000) {
        lastSendBlockToastAt = now
        toast.warning('CranialNerve 正在更新数据，请稍候再发送')
      }
    }
  }
  const sendBtn = document.getElementById('send_but')
  if (sendBtn) {
    sendBtn.addEventListener('click', block, true)
  }
  const textarea = document.getElementById('send_textarea')
  if (textarea) {
    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        block(e)
      }
    }, true)
  }
}

function openPanel(): void {
  if (appMounted) {
    return
  }
  appMounted = true
  prevBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  const root = document.createElement('div')
  root.id = 'cn_app'
  root.style.cssText = 'position:fixed;inset:0;z-index:var(--cn-z-app);background:var(--cn-bg);'
  document.body.appendChild(root)
  appPinia = createPinia()
  appInstance = createApp(App, { onClose: closePanel })
  appInstance.use(appPinia)
  appInstance.use(router)
  appInstance.mount(root)
  router.push('/welcome')
}

function closePanel(): void {
  appInstance?.unmount()
  appInstance = null
  if (appPinia) {
    const store = (appPinia as unknown as { _s: Map<string, { $dispose: () => void }> })._s.get('cn-fill-status')
    store?.$dispose()
    appPinia = null
  }
  const root = document.getElementById('cn_app')
  if (root) {
    root.remove()
  }
  document.body.style.overflow = prevBodyOverflow
  appMounted = false
}
