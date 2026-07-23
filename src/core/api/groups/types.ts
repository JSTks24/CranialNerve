import type { CranialNerveSession } from '../../session'

export interface ApiGroupContext {
	getSession: () => CranialNerveSession
	getApi: () => Record<string, Function>
}
