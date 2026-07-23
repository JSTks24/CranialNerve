import type { ApiGroupContext } from './types'
import type { ChronicleRecaller } from '../../chronicle'

export function createChronicleApi(ctx: ApiGroupContext): Record<string, Function> {
	return {
		getChronicleRecaller(): ChronicleRecaller | null {
			return ctx.getSession().getChronicleRecaller()
		}
	}
}
