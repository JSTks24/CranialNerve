import type { ChronicleEntry } from '@shared/types/worldbook'

const DEFAULT_TIME_PROMPT = 'ISO 8601 格式（YYYY-MM-DDTHH:MM）'

export type TimeCalculator = (entry: ChronicleEntry, currentTime: string) => string
export type TimePromptGetter = () => string

interface TimeRegistration {
	calculator: TimeCalculator | null
	prompt: TimePromptGetter | null
}

const registrations = new Map<string, TimeRegistration>()

function getRegistration(token: string): TimeRegistration {
	let reg = registrations.get(token)
	if (!reg) {
		reg = { calculator: null, prompt: null }
		registrations.set(token, reg)
	}
	return reg
}

export function registerTimeCalculator(token: string, fn: TimeCalculator | null): void {
	getRegistration(token).calculator = fn
}

export function registerTimePrompt(token: string, fn: TimePromptGetter | null): void {
	getRegistration(token).prompt = fn
}

export function clearTimeRegistration(token: string): void {
	registrations.delete(token)
}

export function getTimePromptDescription(token: string): string {
	const reg = registrations.get(token)
	if (reg?.prompt) {
		try {
			return reg.prompt()
		} catch {
			return DEFAULT_TIME_PROMPT
		}
	}
	return DEFAULT_TIME_PROMPT
}

export function validateTimeRegistration(token: string): void {
	const reg = registrations.get(token)
	const hasCalculator = reg?.calculator !== null && reg?.calculator !== undefined
	const hasPrompt = reg?.prompt !== null && reg?.prompt !== undefined
	if (hasCalculator !== hasPrompt) {
		throw new Error(
			'registerTimeCalculator 和 registerTimePrompt 必须成对注册或都不注册'
		)
	}
}

export function computeTimeDelta(token: string, entry: ChronicleEntry, currentTime: string): string {
	const reg = registrations.get(token)
	if (reg?.calculator) {
		try {
			return reg.calculator(entry, currentTime)
		} catch {
			return '时间不明'
		}
	}
	return defaultCompute(entry, currentTime)
}

function defaultCompute(entry: ChronicleEntry, currentTime: string): string {
	const ref = parseTime(currentTime)
	const start = parseTime(entry.timeStart)
	const end = parseTime(entry.timeEnd)
	if (!ref || (!start && !end)) {
		return '时间不明'
	}
	const target = start ?? end ?? ref
	const diffMs = ref.getTime() - target.getTime()
	if (!Number.isFinite(diffMs)) {
		return '时间不明'
	}
	if (diffMs < 0) {
		return '未来'
	}
	if (diffMs < 2 * 3600 * 1000) {
		return '刚刚'
	}
	if (isSameDay(ref, target)) {
		return '今天'
	}
	const dayDiff = dayDifference(ref, target)
	if (dayDiff === 1) {
		return '昨天'
	}
	if (dayDiff === 2) {
		return '前天'
	}
	return `${dayDiff}天前`
}

function parseTime(iso: string | undefined): Date | null {
	if (!iso) {
		return null
	}
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? null : d
}

function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	)
}

function dayDifference(a: Date, b: Date): number {
	const msPerDay = 86400000
	const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
	const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
	return Math.round((da - db) / msPerDay)
}
