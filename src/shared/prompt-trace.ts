import { isDebugMode } from './log-buffer'

export interface PromptTraceSegment {
	role: 'system' | 'user' | 'assistant'
	content: string
}

export interface PromptTraceEntry {
	id: number
	timestamp: number
	scene: string
	model: string
	segments: PromptTraceSegment[]
	segmentCount: number
	response?: string
}

export const MAX_TRACES = 100
let nextTraceId = 1
const traces: PromptTraceEntry[] = []
const subscribers: Array<(entry: PromptTraceEntry) => void> = []

export function pushPromptTrace(input: {
	scene: string
	model: string
	segments: PromptTraceSegment[]
}): number {
	if (!isDebugMode()) return 0
	const entry: PromptTraceEntry = {
		id: nextTraceId++,
		timestamp: Date.now(),
		scene: input.scene,
		model: input.model,
		segments: input.segments.map((s) => ({ role: s.role, content: s.content })),
		segmentCount: input.segments.length,
	}
	traces.push(entry)
	if (traces.length > MAX_TRACES) {
		traces.shift()
	}
	for (const fn of subscribers) {
		try {
			fn(entry)
		} catch {}
	}
	return entry.id
}

export function appendTraceResponse(traceId: number, response: string): void {
	if (!isDebugMode()) return
	const entry = traces.find((t) => t.id === traceId)
	if (entry) {
		entry.response = response
	}
}

export function getAllPromptTraces(): PromptTraceEntry[] {
	return [...traces]
}

export function clearPromptTraces(): void {
	traces.length = 0
}

export function subscribeTrace(fn: (entry: PromptTraceEntry) => void): () => void {
	subscribers.push(fn)
	return () => {
		const idx = subscribers.indexOf(fn)
		if (idx >= 0) {
			subscribers.splice(idx, 1)
		}
	}
}
