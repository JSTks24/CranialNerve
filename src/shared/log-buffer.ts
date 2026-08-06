export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
}

export interface LogEntry {
	id: number
	timestamp: number
	level: LogLevel
	tag: string
	message: string
	traceId?: number
}

const MAX_ENTRIES = 2000
let nextId = 1
const buffer: LogEntry[] = []
const subscribers: Array<(entry: LogEntry) => void> = []

let debugMode = false
export function setDebugMode(value: boolean): void {
	debugMode = value
}
export function isDebugMode(): boolean {
	return debugMode
}

export function pushLog(level: LogLevel, tag: string, message: string, traceId?: number): void {
	if (level === 'debug' && !debugMode) return
	const entry: LogEntry = {
		id: nextId++,
		timestamp: Date.now(),
		level,
		tag,
		message,
		traceId,
	}
	buffer.push(entry)
	if (buffer.length > MAX_ENTRIES) {
		buffer.shift()
	}
	for (const fn of subscribers) {
		try {
			fn(entry)
		} catch {}
	}
}

export function getAllLogs(): LogEntry[] {
	return [...buffer]
}

export function clearLogs(): void {
	buffer.length = 0
}

export function subscribe(fn: (entry: LogEntry) => void): () => void {
	subscribers.push(fn)
	return () => {
		const idx = subscribers.indexOf(fn)
		if (idx >= 0) {
			subscribers.splice(idx, 1)
		}
	}
}
