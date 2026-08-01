<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'

defineProps<{
  onClose?: () => void
}>()

const route = useRoute()
const router = useRouter()

interface MenuItem {
  key: string
  label: string
  icon: string
}

const homeItem: MenuItem = { key: 'welcome', label: '首页', icon: 'fa-house' }

const menuSections: { label: string; items: MenuItem[] }[] = [
  {
    label: '数据',
    items: [
      { key: 'tables', label: '表格', icon: 'fa-table' },
      { key: 'chronicle', label: '纪要', icon: 'fa-clock-rotate-left' }
    ]
  },
  {
    label: '配置',
    items: [
      { key: 'prompts', label: '模板和提示词', icon: 'fa-pen-to-square' },
      { key: 'api', label: 'API 配置', icon: 'fa-plug' },
      { key: 'strategy', label: '运行策略', icon: 'fa-gears' }
    ]
  }
]

const debugItem: MenuItem = { key: 'debug', label: '调试', icon: 'fa-bug' }

const currentKey = computed(() => route.path.slice(1) || 'welcome')

const pageTitle = computed(() => {
  const key = currentKey.value
  if (key === homeItem.key) return homeItem.label
  for (const s of menuSections) {
    const found = s.items.find((m) => m.key === key)
    if (found) return found.label
  }
  if (key === debugItem.key) return '调试工具'
  return 'CranialNerve'
})

function go(key: string) {
  router.push('/' + key)
}

const menuRef = ref<HTMLElement | null>(null)
const itemRefs = new Map<string, HTMLElement>()

const setItemRef = (el: unknown, key: string) => {
  if (el instanceof HTMLElement) itemRefs.set(key, el)
  else itemRefs.delete(key)
}

const updateIndicator = () => {
  const menu = menuRef.value
  const active = itemRefs.get(currentKey.value)
  if (!menu || !active) return
  menu.style.setProperty('--menu-y', `${active.offsetTop}px`)
  menu.style.setProperty('--menu-h', `${active.offsetHeight}px`)
}

let ro: ResizeObserver | null = null

watch(currentKey, async () => {
  await nextTick()
  updateIndicator()
})

onMounted(() => {
  updateIndicator()
  ro = new ResizeObserver(() => updateIndicator())
  if (menuRef.value) ro.observe(menuRef.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  itemRefs.clear()
})
</script>

<template>
  <div class="cn-shell">
    <aside class="cn-sider">
      <div class="cn-brand">
        <i class="fa-solid fa-brain cn-brand__icon"></i>
        <span class="cn-brand__name">CranialNerve</span>
      </div>
      <nav class="cn-menu" ref="menuRef">
        <span class="cn-menu__indicator" aria-hidden="true" />
        <button
          type="button"
          class="cn-menu__item"
          :class="{ 'cn-menu__item--active': homeItem.key === currentKey }"
          :ref="(el) => setItemRef(el, homeItem.key)"
          @click="go(homeItem.key)"
        >
          <i class="fa-solid" :class="homeItem.icon"></i>
          <span>{{ homeItem.label }}</span>
        </button>
        <template v-for="section in menuSections" :key="section.label">
          <div class="cn-menu__section">{{ section.label }}</div>
          <button
            v-for="item in section.items"
            :key="item.key"
            type="button"
            class="cn-menu__item"
            :class="{ 'cn-menu__item--active': item.key === currentKey }"
            :ref="(el) => setItemRef(el, item.key)"
            @click="go(item.key)"
          >
            <i class="fa-solid" :class="item.icon"></i>
            <span>{{ item.label }}</span>
          </button>
        </template>
        <div class="cn-menu__spacer"></div>
        <button
          type="button"
          class="cn-menu__item cn-menu__item--debug"
          :class="{ 'cn-menu__item--active': debugItem.key === currentKey }"
          :ref="(el) => setItemRef(el, debugItem.key)"
          @click="go(debugItem.key)"
        >
          <i class="fa-solid" :class="debugItem.icon"></i>
          <span>{{ debugItem.label }}</span>
        </button>
      </nav>
    </aside>
    <div class="cn-main">
      <header class="cn-header">
        <h1 class="cn-header__title">{{ pageTitle }}</h1>
        <button type="button" class="cn-btn cn-btn--text" @click="onClose">
          <i class="fa-solid fa-xmark"></i>
          <span>关闭</span>
        </button>
      </header>
      <main class="cn-content">
        <RouterView v-slot="{ Component }">
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </RouterView>
      </main>
    </div>
  </div>
</template>
