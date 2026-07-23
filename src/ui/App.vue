<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

defineProps<{
  onClose?: () => void
}>()

const route = useRoute()
const router = useRouter()

const menuItems = [
  { key: 'welcome', label: '首页', icon: 'fa-house' },
  { key: 'tables', label: '表格', icon: 'fa-table' },
  { key: 'chronicle', label: '纪要', icon: 'fa-clock-rotate-left' },
  { key: 'prompts', label: '模板和提示词', icon: 'fa-pen-to-square' },
  { key: 'api', label: 'API 配置', icon: 'fa-plug' }
]

const currentKey = computed(() => route.path.slice(1) || 'welcome')

const pageTitle = computed(() => {
  const item = menuItems.find((m) => m.key === currentKey.value)
  return item?.label ?? 'CranialNerve'
})

function go(key: string) {
  router.push('/' + key)
}
</script>

<template>
  <div class="cn-shell">
    <aside class="cn-sider">
      <div class="cn-brand">
        <i class="fa-solid fa-brain cn-brand__icon"></i>
        <span class="cn-brand__name">CranialNerve</span>
      </div>
      <nav class="cn-menu">
        <button
          v-for="item in menuItems"
          :key="item.key"
          type="button"
          class="cn-menu__item"
          :class="{ 'cn-menu__item--active': item.key === currentKey }"
          @click="go(item.key)"
        >
          <i class="fa-solid" :class="item.icon"></i>
          <span>{{ item.label }}</span>
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
