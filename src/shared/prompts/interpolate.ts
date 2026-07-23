export function interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
        return Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? match) : match
    })
}
