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
    const fresh = session.getConfig()
    fresh.prompt = config.value.prompt
    fresh.tableTemplate = config.value.tableTemplate
    fresh.chronicleTableDef = config.value.chronicleTableDef
    session.saveConfig(fresh)
    config.value = fresh
  }

  return { config, reload, save }
})
