import type { CranialNerveSession } from '../session'
import { pushLog } from '@shared/log-buffer'
import { CHRONICLE_TABLE_NAME } from '@shared/constants/chronicle'

/**
 * 楼层 → 纪要 CN 序号 映射表。
 *
 * 纪要 key（CNxxxx）必须与 AI 楼层一一绑定：首次填某楼层按出现顺序分配递增序号，
 * 重填同楼层复用同序号（由 fill-orchestrator 的 SQL 改写 + REPLACE 覆盖实现）。
 * 序号池单调递增、不回收，保证 key 唯一且稳定。
 *
 * 持久化于聊天元数据 CN_CHRONICLE_KEYMAP（{ [floorIndex]: seq }）；
 * 历史数据可经 migrateChronicleKeymap 从帧记录扫描重建。
 */
const KEYMAP_META = 'CN_CHRONICLE_KEYMAP'

export interface ChronicleKeymap {
  [floorIndex: number]: number
}

/** 从一段 SQL 中提取纪要 CN 序号（CNxxxx），失败返回 null。 */
export function extractChronicleSeq(sql: string): number | null {
	const m = /\bCN(\d{4,})\b/i.exec(sql)
	if (!m) return null
	const n = Number.parseInt(m[1]!, 10)
	return Number.isFinite(n) ? n : null
}

/** 把序号格式化为纪要 key，如 5 → CN0005。 */
export function formatChronicleKey(seq: number): string {
	return `CN${String(seq).padStart(4, '0')}`
}

/** 读取当前聊天映射表（无则返回空对象）。 */
export function readKeymap(session: CranialNerveSession): ChronicleKeymap {
	const raw = session.chat.readChatMetadata(KEYMAP_META)
	if (!raw || typeof raw !== 'object') return {}
	const map: ChronicleKeymap = {}
	for (const [k, v] of Object.entries(raw)) {
		const idx = Number(k)
		if (Number.isFinite(idx) && typeof v === 'number') map[idx] = v
	}
	return map
}

/** 写回映射表（空表则清除元数据）。 */
export function writeKeymap(session: CranialNerveSession, map: ChronicleKeymap): void {
	const keys = Object.keys(map)
	session.chat.writeChatMetadata(KEYMAP_META, keys.length > 0 ? map : undefined)
}

/** 从该楼层帧记录里提取已落帧的纪要 CN 序号（历史/兜底来源）。 */
export function extractSeqFromFrame(session: CranialNerveSession, floorIndex: number): number | null {
	const repo = session.getSyncBridgeRepo()
	if (!repo) return null
	const frame = repo.loadFrame(floorIndex)
	if (!frame) return null
	for (const entry of frame.logEntries) {
		for (const op of entry.operations) {
			if (op.kind !== 'sql_batch' || op.reason !== 'ai_fill_chronicle') continue
			for (const sql of op.statements ?? []) {
				const seq = extractChronicleSeq(sql)
				if (seq != null) return seq
			}
		}
	}
	return null
}

/** 计算下一个未占用的序号（现有最大 + 1）。 */
export function nextSeq(map: ChronicleKeymap): number {
	let max = 0
	for (const v of Object.values(map)) {
		if (v > max) max = v
	}
	return max + 1
}

/** 全局最大序号 = 映射表与全部楼层帧中纪要大序号的较大者，避免新分配与既有纪要冲突。 */
export function findGlobalMaxSeq(session: CranialNerveSession, map: ChronicleKeymap): number {
	let max = 0
	for (const v of Object.values(map)) {
		if (v > max) max = v
	}
	const repo = session.getSyncBridgeRepo()
	if (!repo) return max
	const chat = session.chat.getChat()
	for (let i = 0; i < chat.length; i++) {
		const msg = chat[i]
		if (!msg || msg.is_user || msg.is_system) continue
		const frame = repo.loadFrame(i)
		if (!frame) continue
		for (const entry of frame.logEntries) {
			for (const op of entry.operations) {
				if (op.kind !== 'sql_batch' || op.reason !== 'ai_fill_chronicle') continue
				for (const sql of op.statements ?? []) {
					const seq = extractChronicleSeq(sql)
					if (seq != null && seq > max) max = seq
				}
			}
		}
		// logEntries 被 checkpoint 化后纪要汇总进快照，仍需纳入防冲突
		const snapTable = frame.checkpoint?.data?.tables?.find((t) => t.name === CHRONICLE_TABLE_NAME)
		if (snapTable) {
			for (const row of snapTable.rows ?? []) {
				const v = (row as Record<string, unknown>)['key']
				if (typeof v === 'string') {
					const seq = extractChronicleSeq(v)
					if (seq != null && seq > max) max = seq
				}
			}
		}
	}
	return max
}

/**
 * 只查该楼层当前已知的 CN 序号（映射优先，其次帧推导），不分配、不写回。
 * 用于兜底判断「该层旧纪要 key」；无历史（映射与帧均无）返回 null。
 */
export function lookupFloorSeq(session: CranialNerveSession, floorIndex: number): number | null {
	const map = readKeymap(session)
	if (map[floorIndex] != null) return map[floorIndex]
	return extractSeqFromFrame(session, floorIndex)
}

/** 把该层已确认的 CN 序号写入映射（key 漂移后更新，使下次重填复用新 key）。 */
export function recordFloorSeq(session: CranialNerveSession, floorIndex: number, seq: number): void {
	const map = readKeymap(session)
	if (map[floorIndex] === seq) return
	map[floorIndex] = seq
	writeKeymap(session, map)
}

/**
 * 解析该楼层应有的 CN 序号并保证映射持久化：
 * 映射命中 → 复用；否则从帧推导 → 写回；否则分配（全局最大+1）→ 写回。
 * 分配即占用（SQL 失败也不回退），保证重填同层永远复用同序号。
 */
export function resolveFloorSeq(session: CranialNerveSession, floorIndex: number): number {
	const map = readKeymap(session)
	const existing = map[floorIndex]
	if (existing != null) return existing
	const fromFrame = extractSeqFromFrame(session, floorIndex)
	if (fromFrame != null) {
		map[floorIndex] = fromFrame
		writeKeymap(session, map)
		return fromFrame
	}
	const next = findGlobalMaxSeq(session, map) + 1
	map[floorIndex] = next
	writeKeymap(session, map)
	return next
}

/** 扫描全部楼层帧，为已有纪要的楼层建立映射（历史数据无缝迁移，幂等）。 */
export function migrateChronicleKeymap(session: CranialNerveSession): void {
	try {
		const map = readKeymap(session)
		const chat = session.chat.getChat()
		let changed = false
		for (let i = 0; i < chat.length; i++) {
			const msg = chat[i]
			if (!msg || msg.is_user || msg.is_system) continue
			if (map[i] != null) continue
			const seq = extractSeqFromFrame(session, i)
			if (seq != null) {
				map[i] = seq
				changed = true
			}
		}
		if (changed) writeKeymap(session, map)
	} catch {
		pushLog('warn', 'fill', '迁移纪要 CN 映射失败，将按需惰性建立')
	}
}
