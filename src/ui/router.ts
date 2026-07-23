import { createRouter, createWebHashHistory } from 'vue-router'
import Welcome from './pages/Welcome.vue'
import ApiConfig from './pages/ApiConfig.vue'
import Tables from './pages/Tables.vue'
import Chronicle from './pages/Chronicle.vue'
import PromptConfig from './pages/PromptConfig.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/welcome' },
    { path: '/welcome', component: Welcome },
    { path: '/tables', component: Tables },
    { path: '/chronicle', component: Chronicle },
    { path: '/prompts', component: PromptConfig },
    { path: '/api', component: ApiConfig }
  ]
})

export default router
