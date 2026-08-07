export interface WriteQueue {
	enqueue<T>(task: () => Promise<T>): Promise<T>
	isPending(): boolean
	waitForDrain(timeoutMs?: number): Promise<void>
}

const MAX_PENDING = 100

export default function createWriteQueue(): WriteQueue {
	let tail: Promise<void> = Promise.resolve()
	let pendingCount = 0

	return {
		enqueue(task) {
			if (pendingCount >= MAX_PENDING) {
				return Promise.reject(new Error('write queue overflow'))
			}
			pendingCount++
			const run = tail.then(async () => {
				await Promise.resolve()
				return task()
			})
			tail = run.then(
				() => { pendingCount-- },
				() => { pendingCount-- },
			)
			return run.then((v) => v)
		},
		isPending() {
			return pendingCount > 0
		},
		waitForDrain(timeoutMs) {
			const drain = tail.then(() => undefined)
			if (timeoutMs === undefined || timeoutMs <= 0) {
				return drain
			}
			let timer: ReturnType<typeof setTimeout> | undefined
			const timeout = new Promise<void>((_, reject) => {
				timer = setTimeout(() => reject(new Error('write queue drain timeout')), timeoutMs)
			})
			return Promise.race([drain, timeout]).finally(() => {
				if (timer) clearTimeout(timer)
			})
		},
	}
}
