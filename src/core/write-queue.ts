export interface WriteQueue {
    enqueue<T>(task: () => Promise<T>): Promise<T>
}

export default function createWriteQueue(): WriteQueue {
    let tail: Promise<void> = Promise.resolve()

    return {
        enqueue(task) {
            const run = tail.then(async () => {
                await Promise.resolve()
                return task()
            })
            tail = run.then(
                () => undefined,
                () => undefined,
            )
            return run.then((v) => v)
        },
    }
}
