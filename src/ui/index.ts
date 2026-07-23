import { createApp, type App as VueApp } from 'vue'
import { createPinia } from 'pinia'
import themeCss from './theme.css?inline'
import { getSession } from '@core/session'
import App from './App.vue'
import router from './router'

let themeInjected = false
let appMounted = false
let appInstance: VueApp | null = null

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
  await session.init()
  mountDrawer()
  mountWandButton()
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

function openPanel(): void {
  if (appMounted) {
    return
  }
  appMounted = true
  injectTheme()
  document.body.style.overflow = 'hidden'
  const root = document.createElement('div')
  root.id = 'cn_app'
  root.style.cssText = 'position:fixed;inset:0;z-index:10000;background:var(--cn-bg);'
  document.body.appendChild(root)
  appInstance = createApp(App, { onClose: closePanel })
  appInstance.use(createPinia())
  appInstance.use(router)
  appInstance.mount(root)
}

function closePanel(): void {
  appInstance?.unmount()
  appInstance = null
  const root = document.getElementById('cn_app')
  if (root) {
    root.remove()
  }
  document.body.style.overflow = ''
  appMounted = false
}
