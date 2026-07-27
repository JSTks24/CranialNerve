import type { ApiGroupContext } from './types'
import { registerTimeCalculator, registerTimePrompt } from '../../time'
import type { TimeCalculator, TimePromptGetter } from '../../time'

export function createTimeApi(ctx: ApiGroupContext): Record<string, Function> {
	return {
		registerTimeCalculator(fn: TimeCalculator | null): void {
			registerTimeCalculator(ctx.getSession().getChatToken(), fn)
		},
		registerTimePrompt(fn: TimePromptGetter | null): void {
			registerTimePrompt(ctx.getSession().getChatToken(), fn)
		}
	}
}
