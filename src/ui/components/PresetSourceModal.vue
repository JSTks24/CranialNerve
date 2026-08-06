<template>
  <Transition name="cn-modal">
    <div v-if="visible" class="cn-modal-mask" @click.self="close">
      <div class="cn-modal cn-modal--md">
        <div class="cn-modal__head">
          <span>{{ title }}</span>
          <button class="cn-btn cn-btn--sm cn-btn--text" @click="close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="cn-modal__body">
          <button class="cn-modal-option" @click="pickBlank">
            <span class="cn-modal-option__label">手动空白创建</span>
            <span class="cn-modal-option__desc">从空白开始，手动添加内容</span>
          </button>
          <button
            class="cn-modal-option"
            :class="{ 'cn-modal-option--disabled': defaultDisabled }"
            :disabled="defaultDisabled"
            @click="pickDefault"
          >
            <span class="cn-modal-option__label">{{ defaultLabel }}</span>
            <span class="cn-modal-option__desc">{{ defaultDesc }}</span>
            <span v-if="defaultDisabled" class="cn-modal-option__hint">{{
              defaultDisabledHint
            }}</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
type PickMode = 'blank' | 'default'

const props = defineProps<{
  visible: boolean
  title: string
  defaultLabel: string
  defaultDesc: string
  defaultDisabled: boolean
  defaultDisabledHint: string
}>()

const emit = defineEmits<{
  'update:visible': [boolean]
  pick: [PickMode]
}>()

function close() {
  emit('update:visible', false)
}

function pickBlank() {
  emit('pick', 'blank')
}

function pickDefault() {
  if (!props.defaultDisabled) emit('pick', 'default')
}
</script>
