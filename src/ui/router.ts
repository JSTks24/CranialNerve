import { createRouter, createWebHashHistory } from 'vue-router'
import Welcome from './pages/Welcome.vue'
import ApiConfig from './pages/ApiConfig.vue'
import Tables from './pages/Tables.vue'
import Chronicle from './pages/Chronicle.vue'
import PromptConfig from './pages/PromptConfig.vue'
import Debug from './pages/Debug.vue'
import PendingConfig from './pages/PendingConfig.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/welcome' },
    { path: '/welcome', component: Welcome },
    { path: '/tables', component: Tables },
    { path: '/chronicle', component: Chronicle },
    { path: '/prompts', component: PromptConfig },
    { path: '/api', component: ApiConfig },
    { path: '/pending', component: PendingConfig },
    { path: '/debug', component: Debug }
  ]
})

export default router
