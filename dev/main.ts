import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@ui/theme.css'
import App from '@ui/App.vue'
import router from '@ui/router'
import { getSession } from '@core/session'

getSession()

const app = createApp(App, {
  onClose: () => {
    console.log('[dev] close clicked')
  }
})
app.use(createPinia())
app.use(router)
app.mount('#cn_app')
