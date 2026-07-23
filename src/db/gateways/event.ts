import { getHostContext } from './host-context'

export interface EventGateway {
    on(event: string, handler: (...args: unknown[]) => unknown): void
    off(event: string, handler: (...args: unknown[]) => unknown): void
    makeLast(event: string, handler: (...args: unknown[]) => unknown): void
    getEventType(name: string): string | undefined
}

export default function createEventGateway(): EventGateway {
    return {
        on(event, handler) {
            getHostContext().eventSource.on(event, handler)
        },
        off(event, handler) {
            getHostContext().eventSource.off(event, handler)
        },
        makeLast(event, handler) {
            const es = getHostContext().eventSource
            if (typeof es.makeLast === 'function') {
                es.makeLast(event, handler)
            } else {
                es.on(event, handler)
            }
        },
        getEventType(name) {
            return getHostContext().eventTypes[name]
        },
    }
}
