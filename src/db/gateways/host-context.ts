export function getHostContext(): SillyTavernContext {
    const ctx = window.SillyTavern?.getContext()
    if (!ctx) {
        throw new Error('SillyTavern context unavailable')
    }
    return ctx
}
