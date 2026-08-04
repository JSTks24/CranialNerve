<template>
  <Transition name="cn-modal">
    <div v-if="visible" class="cn-modal-mask" @click.self="close">
      <div class="cn-modal cn-modal--md">
        <div class="cn-modal__head">
          <span>{{ group.label }} · 可用变量</span>
          <button class="cn-btn cn-btn--sm cn-btn--text" @click="close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="cn-modal__body">
          <div v-for="v in group.variables" :key="v.name" class="var-card">
            <span class="var-card__tag">{{ varTag(v.name) }}</span>
            <span class="var-card__desc">{{ v.desc }}</span>
            <button
              class="cn-btn cn-btn--sm cn-btn--text var-card__copy"
              title="复制变量名"
              @click="copyVar(v.name)"
            >
              <i class="fa-solid fa-copy"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PROMPT_VARIABLES } from '@shared/constants'
import type { PromptSceneKey } from '@shared/types/config'
import toast from '@ui/toast'

const props = defineProps<{
  scene: PromptSceneKey
  visible: boolean
}>()

const emit = defineEmits<{ 'update:visible': [boolean] }>()

const group = computed(() => PROMPT_VARIABLES[props.scene])

function close() {
  emit('update:visible', false)
}

function varTag(name: string): string {
  return `{{${name}}}`
}

async function copyVar(name: string) {
  const text = varTag(name)
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`已复制 ${text}`)
  } catch {
    toast.error('复制失败')
  }
}
</script>
