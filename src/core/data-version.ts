type DataChangeSubscriber = () => void

let dataVersion = 0
const dataChangeSubscribers: DataChangeSubscriber[] = []

export function subscribeDataChanged(cb: DataChangeSubscriber): () => void {
	dataChangeSubscribers.push(cb)
	return () => {
		const idx = dataChangeSubscribers.indexOf(cb)
		if (idx >= 0) dataChangeSubscribers.splice(idx, 1)
	}
}

export function notifyDataChanged(): void {
	dataVersion++
	for (const fn of dataChangeSubscribers) {
		try {
			fn()
		} catch {}
	}
}

export function getDataVersion(): number {
	return dataVersion
}
