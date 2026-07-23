export function getHostContext(): SillyTavernContext {
    const ctx = window.SillyTavern?.getContext()
    if (!ctx) {
        throw new Error('SillyTavern context unavailable')
    }
    return ctx
}

export function getRequestHeaders(): Record<string, string> {
    const ctx = getHostContext()
    if (typeof ctx.getRequestHeaders === 'function') {
        return ctx.getRequestHeaders() as Record<string, string>
    }
    return { 'Content-Type': 'application/json' }
}
