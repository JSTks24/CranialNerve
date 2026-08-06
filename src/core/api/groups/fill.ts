import type { ApiGroupContext } from './types'
import type { RunResult } from '../../table/retry-loop'
import { runManualFill, runManualCatchUp, type ExecuteFillOptions, type ManualCatchUpOptions } from '../../table/fill-orchestrator'

export function createFillApi(ctx: ApiGroupContext): Record<string, Function> {
	return {
		async triggerUpdate(): Promise<RunResult> {
			return runManualFill(ctx.getSession())
		},
		async runManualRefill(opts?: ExecuteFillOptions): Promise<RunResult> {
			return runManualFill(ctx.getSession(), { ...opts, clearBeforeFill: true, clearTables: opts?.targetTables ?? [], skipFloors: 0, suppressProgressNotifier: opts?.suppressProgressNotifier ?? true })
		},
		async runManualCatchUp(opts?: ManualCatchUpOptions): Promise<RunResult> {
			return runManualCatchUp(ctx.getSession(), { ...opts, suppressProgressNotifier: opts?.suppressProgressNotifier ?? true })
		},
		async enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
			return ctx.getSession().getWriteQueue().enqueue(task)
		}
	}
}
