import type { ApiGroupContext } from './types'
import type { CardTemplate } from '@shared/types/card'

export function createSessionApi(ctx: ApiGroupContext): Record<string, Function> {
	return {
		initGameSession(template: CardTemplate): void {
			ctx.getSession().initGameSession(template)
		},
		initGameSessionFromCard(): CardTemplate | null {
			return ctx.getSession().initGameSessionFromCard()
		}
	}
}
