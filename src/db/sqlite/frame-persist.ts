import type SqliteCore from './core'
import type { FrameRepo } from './storage-frame-repo'
import type {
	StorageFrame,
	LogEntry,
	MutationOperation,
	SqlBatchOperation,
	CheckpointReason,
	FullCheckpoint
} from '@shared/types/storage-frame'
import { buildSnapshotFromCore } from './snapshot-builder'

export interface PersistContext {
	repo: FrameRepo
	core: SqliteCore
}

export function createPersistContext(repo: FrameRepo, core: SqliteCore): PersistContext {
	return { repo, core }
}

function nextSeq(frame: StorageFrame | null): number {
	if (!frame || frame.logEntries.length === 0) return 1
	return frame.logEntries[frame.logEntries.length - 1]!.seq + 1
}

export function appendSqlLog(
	ctx: PersistContext,
	messageId: number,
	operations: MutationOperation[]
): void {
	if (operations.length === 0) return
	let frame = ctx.repo.loadFrame(messageId)
	if (!frame) {
		frame = { version: 2, logEntries: [] }
	}
	const entry: LogEntry = {
		seq: nextSeq(frame),
		createdAt: Date.now(),
		operations
	}
	frame.logEntries.push(entry)
	ctx.repo.saveFrame(messageId, frame)
}

export function appendSqlBatch(
	ctx: PersistContext,
	messageId: number,
	statements: string[],
	params?: (string | number | null)[][],
	reason: SqlBatchOperation['reason'] = 'ai_fill'
): void {
	const op: SqlBatchOperation = { kind: 'sql_batch', statements, params, reason }
	appendSqlLog(ctx, messageId, [op])
}

export function writeCheckpoint(
	ctx: PersistContext,
	messageId: number,
	reason: CheckpointReason,
	templateId?: string
): void {
	const data = buildSnapshotFromCore(ctx.core)
	const checkpoint: FullCheckpoint = {
		kind: 'full',
		createdAt: Date.now(),
		reason,
		data
	}
	let frame = ctx.repo.loadFrame(messageId)
	if (!frame) {
		frame = { version: 2, logEntries: [] }
	}
	frame.checkpoint = checkpoint
	frame.logEntries = []
	if (templateId !== undefined) {
		frame.templateId = templateId
	}
	ctx.repo.saveFrame(messageId, frame)
}

export function ensureInitCheckpoint(
	ctx: PersistContext,
	messageId: number,
	templateId?: string
): void {
	const existing = ctx.repo.loadFrame(messageId)
	if (existing?.checkpoint) return
	writeCheckpoint(ctx, messageId, 'init', templateId)
}

export function compactAtBoundary(
	ctx: PersistContext,
	retainFloors: number
): void {
	if (retainFloors <= 0) return
	const ids = ctx.repo.listFrameMessageIds()
	if (ids.length <= retainFloors) return
	const boundaryId = ids[retainFloors - 1]
	if (boundaryId == null) return
	writeCheckpoint(ctx, boundaryId, 'compaction')
	for (let i = retainFloors; i < ids.length; i++) {
		const id = ids[i]
		if (id != null) ctx.repo.removeFrame(id)
	}
}
