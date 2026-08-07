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
import type { SnapshotStrategy } from '@shared/types/config'

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

function collectAiFillReasons(operations: MutationOperation[]): SqlBatchOperation['reason'][] {
	const reasons: SqlBatchOperation['reason'][] = []
	for (const op of operations) {
		if (op.kind === 'sql_batch' && op.reason && (op.reason === 'ai_fill' || op.reason === 'ai_fill_table' || op.reason === 'ai_fill_chronicle')) {
			if (!reasons.includes(op.reason)) reasons.push(op.reason)
		}
	}
	return reasons
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
	const reasons = frame.summarizedReasons ?? []
	for (const r of collectAiFillReasons(operations)) {
		if (!reasons.includes(r)) reasons.push(r)
	}
	if (reasons.length > 0) {
		frame.summarizedReasons = reasons
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
	const summarizedReasons = frame.summarizedReasons
	frame.checkpoint = checkpoint
	frame.logEntries = []
	if (summarizedReasons && summarizedReasons.length > 0) {
		frame.summarizedReasons = summarizedReasons
	} else {
		delete frame.summarizedReasons
	}
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

export interface PersistFillOpts {
	strategy: SnapshotStrategy
	interval: number
	retainFloors: number
	templateId?: string
}

export function persistFill(
	ctx: PersistContext,
	messageId: number,
	operations: MutationOperation[],
	opts: PersistFillOpts
): void {
	if (opts.strategy === 'latest-only') {
		ctx.repo.removeAllFrames()
		writeCheckpoint(ctx, messageId, 'manual', opts.templateId)
		return
	}
	const hasAny = ctx.repo.findLatestFrameMessageId() != null
	if (!hasAny) {
		writeCheckpoint(ctx, messageId, 'init', opts.templateId)
		const reasons = collectAiFillReasons(operations)
		if (reasons.length > 0) {
			const frame = ctx.repo.loadFrame(messageId)
			if (frame) {
				const merged = [...new Set([...(frame.summarizedReasons ?? []), ...reasons])]
				frame.summarizedReasons = merged
				ctx.repo.saveFrame(messageId, frame)
			}
		}
		return
	}
	if (operations.length > 0) {
		appendSqlLog(ctx, messageId, operations)
	}
	maybePeriodicCheckpoint(ctx, messageId, opts.interval, opts.templateId)
	if (opts.strategy === 'retain-recent') {
		retainRecentFrames(ctx, opts.retainFloors)
	}
}

function maybePeriodicCheckpoint(
	ctx: PersistContext,
	messageId: number,
	interval: number,
	templateId?: string
): void {
	if (interval <= 0) return
	const ids = ctx.repo.listFrameMessageIds()
	let lastCpId: number | null = null
	for (const id of ids) {
		if (id > messageId) continue
		const f = ctx.repo.loadFrame(id)
		if (f?.checkpoint) {
			lastCpId = id
			break
		}
	}
	if (lastCpId == null) return
	if (lastCpId === messageId) return
	if (messageId - lastCpId >= interval) {
		writeCheckpoint(ctx, messageId, 'periodic', templateId)
	}
}

export function retainRecentFrames(
	ctx: PersistContext,
	retainFloors: number
): void {
	if (retainFloors <= 0) return
	const ids = ctx.repo.listFrameMessageIds()
	if (ids.length <= retainFloors) return
	let hasCpInKeep = false
	for (let i = 0; i < retainFloors; i++) {
		const id = ids[i]
		if (id == null) continue
		const f = ctx.repo.loadFrame(id)
		if (f?.checkpoint) {
			hasCpInKeep = true
			break
		}
	}
	if (!hasCpInKeep) return
	for (let i = retainFloors; i < ids.length; i++) {
		const id = ids[i]
		if (id != null) ctx.repo.removeFrame(id)
	}
}
