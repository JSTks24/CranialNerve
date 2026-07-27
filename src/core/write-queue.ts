export interface WriteQueue {
	enqueue<T>(task: () => Promise<T>): Promise<T>
	isPending(): boolean
	waitForDrain(): Promise<void>
}

export default function createWriteQueue(): WriteQueue {
	let tail: Promise<void> = Promise.resolve()
	let pendingCount = 0

	return {
		enqueue(task) {
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
		waitForDrain() {
			return tail.then(() => undefined)
		},
	}
}
