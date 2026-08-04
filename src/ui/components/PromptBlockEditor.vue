<script setup lang="ts">
import { ref, watch } from 'vue'
import draggable from 'vuedraggable'
import PromptSegmentEditor from './PromptSegmentEditor.vue'
import type { PromptSegment, PromptRole } from '@shared/types/config'

const props = defineProps<{ modelValue: PromptSegment[]; minSegments?: number; showAddRow?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [PromptSegment[]] }>()

const roles: PromptRole[] = ['system', 'user', 'assistant']
const roleLabels: Record<PromptRole, string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant'
}

const segments = ref<PromptSegment[]>(props.modelValue.map((s) => ({ ...s })))

watch(
  () => props.modelValue,
  (v) => {
    if (v !== segments.value) {
      segments.value = v.map((s) => ({ ...s }))
    }
  }
)

watch(
  segments,
  (v) => {
    emit('update:modelValue', v)
  },
  { deep: true }
)

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function addSegment(role: PromptRole) {
  segments.value.push({
    id: newId('seg'),
    name: `段 ${segments.value.length + 1}`,
    role,
    content: ''
  })
}

function removeSegment(id: string) {
  if (segments.value.length <= (props.minSegments ?? 0)) return
  segments.value = segments.value.filter((s) => s.id !== id)
}

function cycleRole(seg: PromptSegment) {
  const idx = roles.indexOf(seg.role)
  seg.role = roles[(idx + 1) % roles.length]!
}

defineExpose({ addSegment, roles, roleLabels })
</script>

<template>
  <draggable
    :list="segments"
    item-key="id"
    :animation="150"
    handle=".seg-item__grip"
    ghost-class="seg-item--ghost"
    class="block-list"
  >
    <template #item="{ element: seg, index: si }">
      <div class="seg-item">
        <div class="seg-item__bar">
          <i class="fa-solid fa-grip-vertical seg-item__grip"></i>
          <button
            class="seg-item__role"
            :title="`点击切换角色（当前 ${roleLabels[seg.role]}）`"
            @click="cycleRole(seg)"
          >
            {{ roleLabels[seg.role] }}
          </button>
          <input class="cn-input seg-item__name" v-model="seg.name" placeholder="段名称" />
          <span class="seg-item__seq">#{{ si + 1 }}</span>
          <button
            class="cn-btn cn-btn--sm cn-btn--text"
            title="删除"
            @click="removeSegment(seg.id)"
          >
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
        <PromptSegmentEditor v-model="seg.content" />
      </div>
    </template>
  </draggable>
  <div v-if="showAddRow !== false" class="seg-add-row">
    <button v-for="r in roles" :key="r" class="cn-btn cn-btn--sm" @click="addSegment(r)">
      <i class="fa-solid fa-plus"></i>
      {{ roleLabels[r] }}
    </button>
  </div>
</template>
