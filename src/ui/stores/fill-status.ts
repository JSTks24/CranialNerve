import { defineStore } from 'pinia'
import { ref, computed, watch, onScopeDispose } from 'vue'
import { subscribeFillState, getFillState, type FillRunMode, type FillProgressState } from '@core/table/fill-orchestrator'
import toast from '@ui/toast'

export const useFillStatusStore = defineStore('cn-fill-status', () => {
  const busy = ref(getFillState().busy)
  const runMode = ref<FillRunMode | null>(getFillState().runMode)
  const progress = ref<FillProgressState | null>(getFillState().progress)
  const unsubscribe = subscribeFillState((b, r, p) => {
    busy.value = b
    runMode.value = r
    progress.value = p
  })
  onScopeDispose(unsubscribe)
  const tableActive = computed(() => busy.value && (runMode.value === 'table' || runMode.value === 'merged'))
  const chronicleActive = computed(() => busy.value && (runMode.value === 'chronicle' || runMode.value === 'merged'))
  const progressTick = computed(() => progress.value?.tick ?? 0)
  const currentBucket = computed(() => progress.value?.currentBucket ?? 0)
  const totalBuckets = computed(() => progress.value?.totalBuckets ?? 0)
  let tokenWarned = false
  watch(() => busy.value, (b) => {
    if (b) tokenWarned = false
  })
  watch(
    () => progress.value?.tokenWarn,
    (w, prev) => {
      if (!w) return
      if (prev && prev.maxTokens === w.maxTokens && prev.estimatedTokens === w.estimatedTokens) return
      if (tokenWarned) return
      tokenWarned = true
      toast.warning(`第 ${progress.value?.currentBucket ?? '?'}/${progress.value?.totalBuckets ?? '?'} 批预计输出约 ${w.estimatedTokens} tokens，超出预设 maxTokens（${w.maxTokens}），建议减小每批楼层数或调大 maxTokens`)
    }
  )
  return { busy, runMode, progress, progressTick, currentBucket, totalBuckets, tableActive, chronicleActive }
})
