import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { subscribeFillState, getFillState, type FillRunMode } from '@core/table/fill-orchestrator'

export const useFillStatusStore = defineStore('cn-fill-status', () => {
  const busy = ref(getFillState().busy)
  const runMode = ref<FillRunMode | null>(getFillState().runMode)
  subscribeFillState((b, r) => {
    busy.value = b
    runMode.value = r
  })
  const tableActive = computed(() => busy.value && (runMode.value === 'table' || runMode.value === 'merged'))
  const chronicleActive = computed(() => busy.value && (runMode.value === 'chronicle' || runMode.value === 'merged'))
  return { busy, runMode, tableActive, chronicleActive }
})
