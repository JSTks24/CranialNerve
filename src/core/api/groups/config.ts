import type { ApiGroupContext } from './types'
import type { AiPreset, CranialNerveConfig } from '@shared/types/config'

export function createConfigApi(ctx: ApiGroupContext): Record<string, Function> {
	return {
		getConfig(): CranialNerveConfig {
			return ctx.getSession().getConfig()
		},
		saveConfig(config: CranialNerveConfig): void {
			ctx.getSession().saveConfig(config)
		},
		getActiveAiPreset(): AiPreset | null {
			return ctx.getSession().getActiveAiPreset()
		}
	}
}
