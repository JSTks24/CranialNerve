import type { ApiGroupContext } from './types'
import type { RunResult } from '../../table/retry-loop'
import { runManualFill } from '../../table/fill-orchestrator'

export function createFillApi(ctx: ApiGroupContext): Record<string, Function> {
	return {
		async triggerUpdate(): Promise<RunResult> {
			return runManualFill(ctx.getSession())
		},
		async enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
			return ctx.getSession().getWriteQueue().enqueue(task)
		}
	}
}
