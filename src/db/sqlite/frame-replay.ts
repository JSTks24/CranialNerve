import type { FrameRepo } from './storage-frame-repo'
import type { DatabaseSnapshot } from '@shared/types/table'
import type { MutationOperation } from '@shared/types/storage-frame'
import { pushLog } from '@shared/log-buffer'

export interface ReplayResult {
	snapshot: DatabaseSnapshot | null
	operations: MutationOperation[][]
	warnings: string[]
	snapshotIndex: number | null
}

export function replayFrames(repo: FrameRepo): ReplayResult {
	const warnings: string[] = []
	const latestFrameId = repo.findLatestFrameMessageId()

	if (latestFrameId == null) {
		return { snapshot: null, operations: [], warnings, snapshotIndex: null }
	}

	let checkpointSnapshot: DatabaseSnapshot | null = null
	let checkpointMessageId: number | null = null
	for (let i = latestFrameId; i >= 0; i--) {
		const frame = repo.loadFrame(i)
		if (frame?.checkpoint?.data) {
			checkpointSnapshot = frame.checkpoint.data
			checkpointMessageId = i
			break
		}
	}

	if (checkpointSnapshot == null) {
		warnings.push('V2 frame 存在但无 checkpoint，将从模板初始化空表')
		return { snapshot: null, operations: [], warnings, snapshotIndex: latestFrameId }
	}

	const operations: MutationOperation[][] = []
	if (checkpointMessageId != null) {
		for (let i = checkpointMessageId; i <= latestFrameId; i++) {
			const frame = repo.loadFrame(i)
			if (!frame) continue
			for (const entry of frame.logEntries) {
				operations.push(entry.operations)
			}
		}
	}

	return { snapshot: checkpointSnapshot, operations, warnings, snapshotIndex: latestFrameId }
}

export function splitStatements(sql: string): string[] {
	const out: string[] = []
	let current = ''
	let inSingle = false
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i]
		if (ch === "'") {
			inSingle = !inSingle
			current += ch
			continue
		}
		if (ch === ';' && !inSingle) {
			const trimmed = current.trim()
			if (trimmed.length > 0) out.push(trimmed)
			current = ''
			continue
		}
		current += ch
	}
	const trimmed = current.trim()
	if (trimmed.length > 0) out.push(trimmed)
	return out
}

export function logReplayWarning(msg: string): void {
	pushLog('warn', 'replay', msg)
}
