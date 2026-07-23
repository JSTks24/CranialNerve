import { getSession } from '../session'
import type { ApiGroupContext } from './groups/types'
import { createSessionApi } from './groups/session'
import { createTableApi } from './groups/table'
import { createFillApi } from './groups/fill'
import { createChronicleApi } from './groups/chronicle'
import { createTimeApi } from './groups/time'
import { createConfigApi } from './groups/config'

let apiRef: Record<string, Function> | null = null

const ctx: ApiGroupContext = {
	getSession,
	getApi: () => apiRef ?? {}
}

const api = Object.assign(
	{},
	createSessionApi(ctx),
	createTableApi(ctx),
	createFillApi(ctx),
	createChronicleApi(ctx),
	createTimeApi(ctx),
	createConfigApi(ctx)
)

apiRef = api

export function getCNApi(): Record<string, Function> {
	return api
}
