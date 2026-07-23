import type { ApiGroupContext } from './types'
import { registerTimeCalculator, registerTimePrompt } from '../../time'
import type { TimeCalculator, TimePromptGetter } from '../../time'

export function createTimeApi(_ctx: ApiGroupContext): Record<string, Function> {
	return {
		registerTimeCalculator(fn: TimeCalculator | null): void {
			registerTimeCalculator(fn)
		},
		registerTimePrompt(fn: TimePromptGetter | null): void {
			registerTimePrompt(fn)
		}
	}
}
