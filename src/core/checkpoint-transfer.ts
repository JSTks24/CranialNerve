import type { CranialNerveSession } from './session'
import type { TableCheckpointFileV1 } from '@shared/types/checkpoint-file'
import { CHECKPOINT_FORMAT, CHECKPOINT_VERSION } from '@shared/types/checkpoint-file'
import { buildSnapshotFromCore } from '@db/sqlite/snapshot-builder'

function fnv1aHash(input: string): string {
	let hash = 0x811c9dc5
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193)
	}
	return (hash >>> 0).toString(16)
}

function computePayloadHash(file: Omit<TableCheckpointFileV1, 'integrity'>): string {
	const payload = JSON.stringify({
		format: file.format,
		version: file.version,
		createdAt: file.createdAt,
		tableSnapshot: file.tableSnapshot,
		templateSnapshot: file.templateSnapshot
	})
	return fnv1aHash(payload)
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function scanDangerousKeys(obj: unknown, path: string): string | null {
	if (obj === null || typeof obj !== 'object') return null
	const record = obj as Record<string, unknown>
	for (const key of Object.keys(record)) {
		if (DANGEROUS_KEYS.has(key)) return `${path}.${key}`
		const child = record[key]
		if (child !== null && typeof child === 'object') {
			const found = scanDangerousKeys(child, `${path}.${key}`)
			if (found) return found
		}
	}
	return null
}

export function exportCheckpoint(session: CranialNerveSession): TableCheckpointFileV1 {
	const tableSnapshot = buildSnapshotFromCore(session.core)
	const templateSnapshot = session.getTemplate()
	if (!templateSnapshot) {
		throw new Error('无模板，无法导出')
	}
	const file: Omit<TableCheckpointFileV1, 'integrity'> = {
		format: CHECKPOINT_FORMAT,
		version: CHECKPOINT_VERSION,
		createdAt: Date.now(),
		tableSnapshot,
		templateSnapshot
	}
	const integrity = { algorithm: 'fnv1a' as const, payloadHash: computePayloadHash(file) }
	return { ...file, integrity }
}

export interface ImportResult {
	ok: boolean
	error?: string
}

export function validateCheckpointFile(raw: unknown): ImportResult {
	if (raw === null || typeof raw !== 'object') {
		return { ok: false, error: '文件不是有效 JSON 对象' }
	}
	const file = raw as TableCheckpointFileV1
	if (file.format !== CHECKPOINT_FORMAT) {
		return { ok: false, error: `格式不符（期望 ${CHECKPOINT_FORMAT}）` }
	}
	if (file.version !== CHECKPOINT_VERSION) {
		return { ok: false, error: `版本不符（期望 ${CHECKPOINT_VERSION}）` }
	}
	if (!Array.isArray(file.tableSnapshot?.tables)) {
		return { ok: false, error: 'tableSnapshot 结构异常' }
	}
	if (!Array.isArray(file.templateSnapshot?.tables)) {
		return { ok: false, error: 'templateSnapshot 结构异常' }
	}
	const dangerous = scanDangerousKeys(file, 'root')
	if (dangerous) {
		return { ok: false, error: `检测到危险键: ${dangerous}` }
	}
	const expectedHash = computePayloadHash({
		format: file.format,
		version: file.version,
		createdAt: file.createdAt,
		tableSnapshot: file.tableSnapshot,
		templateSnapshot: file.templateSnapshot
	})
	if (file.integrity?.payloadHash !== expectedHash) {
		return { ok: false, error: '完整性校验失败（哈希不匹配）' }
	}
	return { ok: true }
}
