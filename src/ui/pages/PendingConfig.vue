<script setup lang="ts">
// 待定配置页：本页配置项尚未归入最终位置，待 UI 布局确定后整体迁移至对应配置页
import { ref, onActivated } from 'vue'
import { getSession } from '@core/session'
import type { CranialNerveConfig } from '@shared/types/config'
import toast from '@ui/toast'

const session = getSession()
const cfg = ref<CranialNerveConfig>(session.getConfig())

function clampInt(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(raw)))
}

function saveField(field: 'aiCallTimeoutMs' | 'aiTimeoutRetries' | 'listModelsTimeoutMs' | 'writeQueueDrainTimeoutMs' | 'minSummaryLength', min: number, max: number, fallback: number) {
  cfg.value.pending[field] = clampInt(cfg.value.pending[field] as number, min, max, fallback)
  session.saveConfig(cfg.value)
  toast.success('已保存')
}

function saveBoolean(field: 'summarizeOnManualAbort') {
  session.saveConfig(cfg.value)
  toast.success('已保存')
}

onActivated(() => {
  cfg.value = session.getConfig()
})
</script>

<template>
  <div class="pending-page">
    <div class="cn-card pending-card">
      <div class="cn-card__head">
        <h3 class="pending-card__title">AI 调用超时与重试</h3>
        <span class="pending-card__badge">待定配置</span>
      </div>
      <div class="cn-card__body">
        <div class="cn-empty pending-hint">
          <i class="fa-solid fa-circle-info" style="color:var(--cn-text-3);font-size:18px;margin-bottom:8px"></i>
          <span>此处配置项尚未最终归类，后续将迁移到更合适的位置。</span>
        </div>

        <div class="pending-kv">
          <div class="pending-kv__row">
            <span class="pending-kv__label">AI 调用超时（毫秒）</span>
            <input
              class="cn-input pending-kv__input"
              type="number"
              min="1000"
              max="600000"
              step="1000"
              v-model.number="cfg.pending.aiCallTimeoutMs"
              @blur="saveField('aiCallTimeoutMs', 1000, 600000, 60000)"
              @change="saveField('aiCallTimeoutMs', 1000, 600000, 60000)"
            />
          </div>
          <p class="pending-kv__desc">
            单次 AI 请求最长等待时间。超时后按下方次数重试，仍失败则计入填表失败。
            范围 1000-600000。默认 60000（60 秒）。
          </p>
        </div>

        <div class="pending-kv">
          <div class="pending-kv__row">
            <span class="pending-kv__label">超时后重试次数</span>
            <input
              class="cn-input pending-kv__input"
              type="number"
              min="0"
              max="10"
              step="1"
              v-model.number="cfg.pending.aiTimeoutRetries"
              @blur="saveField('aiTimeoutRetries', 0, 10, 1)"
              @change="saveField('aiTimeoutRetries', 0, 10, 1)"
            />
          </div>
          <p class="pending-kv__desc">
            AI 调用超时后自动重试的次数。0=超时即失败不重试。范围 0-10。默认 1。
          </p>
        </div>

        <div class="pending-kv">
          <div class="pending-kv__row">
            <span class="pending-kv__label">拉模型列表超时（毫秒）</span>
            <input
              class="cn-input pending-kv__input"
              type="number"
              min="1000"
              max="600000"
              step="1000"
              v-model.number="cfg.pending.listModelsTimeoutMs"
              @blur="saveField('listModelsTimeoutMs', 1000, 600000, 10000)"
              @change="saveField('listModelsTimeoutMs', 1000, 600000, 10000)"
            />
          </div>
          <p class="pending-kv__desc">
            配置 API 时拉取模型列表的最长等待时间。慢网络可调大。范围 1000-600000。默认 10000（10 秒）。
          </p>
        </div>

        <div class="pending-kv">
          <div class="pending-kv__row">
            <span class="pending-kv__label">写队列排空超时（毫秒）</span>
            <input
              class="cn-input pending-kv__input"
              type="number"
              min="1000"
              max="600000"
              step="1000"
              v-model.number="cfg.pending.writeQueueDrainTimeoutMs"
              @blur="saveField('writeQueueDrainTimeoutMs', 1000, 600000, 8000)"
              @change="saveField('writeQueueDrainTimeoutMs', 1000, 600000, 8000)"
            />
          </div>
          <p class="pending-kv__desc">
            切换聊天时等待写入队列排空的最长时间，超时强制继续重建。范围 1000-600000。默认 8000（8 秒）。
          </p>
        </div>
      </div>
    </div>

    <div class="cn-card pending-card">
      <div class="cn-card__head">
        <h3 class="pending-card__title">纪要总结控制</h3>
        <span class="pending-card__badge">待定配置</span>
      </div>
      <div class="cn-card__body">
        <div class="cn-empty pending-hint">
          <i class="fa-solid fa-circle-info" style="color:var(--cn-text-3);font-size:18px;margin-bottom:8px"></i>
          <span>此处配置项尚未最终归类，后续将迁移到更合适的位置。</span>
        </div>

        <div class="pending-kv">
          <div class="pending-kv__row">
            <span class="pending-kv__label">手动中止时仍总结</span>
            <label class="cn-switch">
              <input type="checkbox" v-model="cfg.pending.summarizeOnManualAbort" @change="saveBoolean('summarizeOnManualAbort')" />
              <span class="cn-switch__track"></span>
            </label>
          </div>
          <p class="pending-kv__desc">
            用户手动中断 AI 生成时是否仍进行纪要总结。关闭则手动中止不总结（默认）。自动结束不受影响。
          </p>
        </div>

        <div class="pending-kv">
          <div class="pending-kv__row">
            <span class="pending-kv__label">最小总结字数</span>
            <input
              class="cn-input pending-kv__input"
              type="number"
              min="0"
              max="10000"
              step="10"
              v-model.number="cfg.pending.minSummaryLength"
              @blur="saveField('minSummaryLength', 0, 10000, 100)"
              @change="saveField('minSummaryLength', 0, 10000, 100)"
            />
          </div>
          <p class="pending-kv__desc">
            AI 回复少于该字数时不进行纪要总结（防"嗯""好的"等短回复触发总结）。0=不限制。默认 100。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
