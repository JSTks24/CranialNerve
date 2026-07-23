import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSession } from '@core/session'
import type { CranialNerveConfig } from '@shared/types/config'

export const useConfigStore = defineStore('cn-config', () => {
  const session = getSession()
  const config = ref<CranialNerveConfig>(session.getConfig())

  function reload() {
    config.value = session.getConfig()
  }

  function save() {
    session.saveConfig(config.value)
  }

  return { config, reload, save }
})
